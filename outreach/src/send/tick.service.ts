import { randomUUID } from 'node:crypto';

import type { MimeSignature } from '../core/mime';
import { isSlotMissed, nextFollowUpSlot, nextSendSlot } from '../core/send-scheduler';
import type { AppConfig } from '../config/app-config';
import type { CompanyRecord, OutreachStore, SendRecord } from '../db/outreach-store';

import { GmailApiError, GmailAuthError, GmailTokenError } from './gmail-client';
import type { GmailClient } from './gmail-client';
import { buildOutgoingMessage, FollowUpNotThreadableError } from './outgoing-message';
import { classifyThread } from './reply-classifier';
import { SignatureMissingError, SIGNATURE_HINT } from './signature';
import { occupiedSlots, recipientZoneFor, schedulerOptionsFor } from './slot-planning';

// The 5-minute tick (SPEC section 7). No LLM, no agent: it syncs replies, schedules, and sends what is due.
// Every outbound step is idempotent: the unique (draft, kind) send row is the no-double-send guard, a row is
// claimed (`sending`, committed) after a fresh access token is in hand and before Gmail is called, and a send
// whose outcome is unknown is never retried.

export const STUCK_SENDING_MINUTES = 15;
/** How long after the last send a thread is still polled for replies. */
export const REPLY_WATCH_DAYS = 21;
/** A tick only sends what is due within this window, waiting for it if needed; the next trigger takes the rest. */
export const DEFAULT_LOOKAHEAD_MINUTES = 4;
export const TICK_LEASE_NAME = 'tick';
/** Longer than the lookahead plus a send, so a healthy tick renewing before each send never loses it. */
export const TICK_LEASE_TTL_MS = 6 * 60_000;
const COMPLETE_SEND_ATTEMPTS = 3;
const COMPLETE_SEND_BACKOFF_MS = 1000;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Gmail answers these 403 reasons when it throttles, like a 429: the message was not accepted. */
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set(['userRateLimitExceeded', 'rateLimitExceeded']);

export interface TickDeps {
  store: OutreachStore;
  gmail: GmailClient;
  config: AppConfig;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Throws SignatureMissingError when there is no usable signature; the send phase then refuses to run. */
  loadSignature: () => MimeSignature;
  /** Resume PDF bytes by the path stored on the draft (relative to outreach/). */
  readResume: (relativePath: string) => Promise<Buffer>;
  random?: () => number;
  lookaheadMinutes?: number;
  /** Identifies this tick in the lease row; random per run by default. */
  holder?: string;
}

export interface TickReport {
  /** Another tick holds the lease, so this one did nothing. */
  skippedLocked: boolean;
  /** This tick lost its lease mid-run (it expired and another tick took over) and stopped. */
  leaseLost: boolean;
  /** Why the send phase did not run (for example a missing signature), else null. */
  sendsRefused: string | null;
  replied: number;
  optedOut: number;
  bounced: number;
  scheduled: number;
  followUpsScheduled: number;
  rescheduled: number;
  sent: number;
  retried: number;
  failed: number;
  unknown: number;
  cancelled: number;
  errors: string[];
}

function emptyReport(): TickReport {
  return {
    skippedLocked: false,
    leaseLost: false,
    sendsRefused: null,
    replied: 0,
    optedOut: 0,
    bounced: 0,
    scheduled: 0,
    followUpsScheduled: 0,
    rescheduled: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    unknown: 0,
    cancelled: 0,
    errors: [],
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class LeaseLostError extends Error {}

/**
 * Runs one tick while holding the lease. An authorization or token-endpoint failure, or a lost lease, ends the
 * tick and is reported, not thrown; nothing had been claimed when it happened.
 */
export async function runTick(deps: TickDeps): Promise<TickReport> {
  const report = emptyReport();
  const holder = deps.holder ?? randomUUID();
  if (!(await deps.store.acquireLease(TICK_LEASE_NAME, holder, TICK_LEASE_TTL_MS))) {
    report.skippedLocked = true;
    return report;
  }
  try {
    await runPhases(deps, holder, report);
  } catch (error) {
    if (error instanceof GmailAuthError) report.errors.push(`gmail_auth: ${error.message}`);
    else if (error instanceof GmailTokenError) report.errors.push(`gmail_token: ${error.message}`);
    else if (error instanceof LeaseLostError) {
      report.leaseLost = true;
      report.errors.push('lease_lost: another tick took over; stopped before sending more');
    } else throw error;
  } finally {
    // A failed release only means the lease runs out by itself.
    await deps.store.releaseLease(TICK_LEASE_NAME, holder).catch(() => undefined);
  }
  return report;
}

async function runPhases(deps: TickDeps, holder: string, report: TickReport): Promise<void> {
  const senderEmail = requireSenderEmail(deps.config);
  await sweepStuckSends(deps, report);
  await syncReplies(deps, senderEmail, report);
  await rescheduleMissed(deps, report);
  await scheduleInitialSends(deps, report);
  await scheduleFollowUps(deps, senderEmail, report);
  await sendDueMessages(deps, holder, senderEmail, report);
}

function requireSenderEmail(config: AppConfig): string {
  const email = config.outreach.sender_email;
  if (!email) throw new Error('sender_email is missing in outreach.config.json');
  return email.toLowerCase();
}

// ── (0) Stuck sends ─────────────────────────────────────────────────────────

// A row left in `sending` means the process died around the Gmail call: the email may or may not have gone
// out. It is parked as `unknown` for a human to check in the Sent folder and is never sent again.
async function sweepStuckSends(deps: TickDeps, report: TickReport): Promise<void> {
  const now = deps.now().getTime();
  for (const send of await deps.store.listSends({ statuses: ['sending'] })) {
    if (now - send.updatedAt.getTime() <= STUCK_SENDING_MINUTES * MINUTE_MS) continue;
    await markUnknown(deps, send, 'stuck in sending; outcome unknown');
    report.unknown += 1;
  }
}

async function markUnknown(deps: TickDeps, send: SendRecord, reason: string): Promise<void> {
  await deps.store.updateSend(send.id, { status: 'unknown', error: reason });
  await deps.store.recordEvent(send.companyId, 'send.unknown', { sendId: send.id, kind: send.kind });
  if (send.kind === 'initial') {
    await deps.store.updateCompany(send.companyId, { statusReason: 'send outcome unknown: check the Sent folder' });
  }
}

/** Surfaces a send that will not be retried on its own: the review screen shows the company's reason. */
async function recordSendFailure(deps: TickDeps, send: SendRecord, reason: string): Promise<void> {
  await deps.store.updateSend(send.id, { status: 'failed', error: reason });
  await deps.store.updateCompany(send.companyId, { statusReason: `${send.kind} send failed: ${reason}`.slice(0, 300) });
}

// ── (a) Replies and bounces ─────────────────────────────────────────────────

async function syncReplies(deps: TickDeps, senderEmail: string, report: TickReport): Promise<void> {
  const companies = await deps.store.listCompanies({ statuses: ['sent'] });
  if (companies.length === 0) return;
  const sentRows = await deps.store.listSends({ statuses: ['sent'] });
  const watchSince = deps.now().getTime() - REPLY_WATCH_DAYS * DAY_MS;

  for (const company of companies) {
    const own = sentRows.filter((send) => send.companyId === company.id);
    const lastSentAt = Math.max(...own.map((send) => (send.sentAt ?? send.scheduledAt).getTime()));
    const threadId = own.find((send) => send.providerThreadId)?.providerThreadId;
    if (!threadId || lastSentAt < watchSince) continue;

    let verdict;
    try {
      verdict = classifyThread(await deps.gmail.getThread(threadId), senderEmail);
    } catch (error) {
      if (error instanceof GmailAuthError || error instanceof GmailTokenError) throw error;
      report.errors.push(`thread_sync ${company.slug}: ${describe(error)}`);
      continue;
    }

    if (verdict.kind === 'replied') {
      const contact = await deps.store.getContact(company.id);
      await deps.store.recordInbound(company.id, {
        status: 'replied',
        statusReason: verdict.optOut ? 'asked to stop: never email again' : null,
        ...(verdict.optOut && contact ? { suppressEmail: { email: contact.email, reason: 'asked to stop' } } : {}),
      });
      report.replied += 1;
      if (verdict.optOut) report.optedOut += 1;
    } else if (verdict.kind === 'bounced') {
      await deps.store.recordInbound(company.id, { status: 'bounced', statusReason: 'delivery failure notice' });
      report.bounced += 1;
    }
  }
}

// ── (b) Scheduling ──────────────────────────────────────────────────────────

// A slot missed by more than 2 hours (PC was off) moves to the next window instead of landing at night.
async function rescheduleMissed(deps: TickDeps, report: TickReport): Promise<void> {
  const sends = await deps.store.listSends();
  const options = await schedulerOptionsFor(deps.store, deps.config, sends, deps.now());
  const now = deps.now();

  for (const send of sends.filter((entry) => entry.status === 'scheduled' && isSlotMissed(entry.scheduledAt, now))) {
    const slot = nextSendSlot({
      recipientZone: await recipientZoneFor(deps.store, deps.config, send.companyId),
      notBefore: now,
      existingSlots: occupiedSlots(sends, send.id),
      options,
      random: deps.random,
    });
    const updated = await deps.store.updateSend(send.id, { scheduledAt: slot });
    sends[sends.findIndex((entry) => entry.id === send.id)] = updated;
    report.rescheduled += 1;
  }
}

async function scheduleInitialSends(deps: TickDeps, report: TickReport): Promise<void> {
  const approved = await deps.store.listCompanies({ statuses: ['approved'] });
  if (approved.length === 0) return;
  const sends = await deps.store.listSends();
  const options = await schedulerOptionsFor(deps.store, deps.config, sends, deps.now());

  for (const company of approved) {
    const draft = await deps.store.getLatestDraft(company.id);
    if (!draft || draft.status !== 'approved') continue;
    if (sends.some((send) => send.draftId === draft.id && send.kind === 'initial')) continue;

    const slot = nextSendSlot({
      recipientZone: await recipientZoneFor(deps.store, deps.config, company.id),
      notBefore: deps.now(),
      existingSlots: occupiedSlots(sends),
      options,
      random: deps.random,
    });
    const created = await deps.store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: slot });
    if (created) {
      sends.push(created);
      report.scheduled += 1;
    }
  }
}

// ── (c) Follow-ups ──────────────────────────────────────────────────────────

async function scheduleFollowUps(deps: TickDeps, senderEmail: string, report: TickReport): Promise<void> {
  const sends = await deps.store.listSends();
  const sentInitials = sends.filter((send) => send.kind === 'initial' && send.status === 'sent' && send.sentAt !== null);
  const pending = sentInitials.filter(
    (initial) => !sends.some((send) => send.draftId === initial.draftId && send.kind === 'follow_up'),
  );
  if (pending.length === 0) return;
  const options = await schedulerOptionsFor(deps.store, deps.config, sends, deps.now());

  for (const initial of pending) {
    const company = await deps.store.getCompany(initial.companyId);
    if (company?.status !== 'sent') continue;
    const draft = await deps.store.getDraft(initial.draftId);
    if (!draft || draft.followUpBody.trim() === '') continue;

    // Gmail may rewrite the Message-ID, and the read-back after sending can fail; the thread still has the real one.
    if (initial.providerMessageId === null && !(await backfillMessageId(deps, initial, company, senderEmail, report))) {
      continue;
    }

    const zone = await recipientZoneFor(deps.store, deps.config, company.id);
    let slot = nextFollowUpSlot({
      sentAt: initial.sentAt as Date,
      businessDays: deps.config.outreach.follow_up_business_days,
      recipientZone: zone,
      existingSlots: occupiedSlots(sends),
      options,
      random: deps.random,
    });
    // Already past (the PC was off for days): send in the next window, not at a stale time.
    if (slot.getTime() < deps.now().getTime()) {
      slot = nextSendSlot({
        recipientZone: zone,
        notBefore: deps.now(),
        existingSlots: occupiedSlots(sends),
        options,
        random: deps.random,
      });
    }
    const created = await deps.store.createSend({ draftId: draft.id, kind: 'follow_up', scheduledAt: slot });
    if (created) {
      sends.push(created);
      report.followUpsScheduled += 1;
    }
  }
}

async function backfillMessageId(
  deps: TickDeps,
  initial: SendRecord,
  company: CompanyRecord,
  senderEmail: string,
  report: TickReport,
): Promise<boolean> {
  if (!initial.providerThreadId) {
    report.errors.push(`message_id_backfill ${company.slug}: the first email has no stored thread`);
    return false;
  }
  try {
    const thread = await deps.gmail.getThread(initial.providerThreadId);
    const first = thread.find((message) => message.rfcMessageId && message.from.toLowerCase().includes(senderEmail));
    if (!first?.rfcMessageId) {
      // Without it the follow-up cannot be threaded, so it stays unscheduled until a human looks.
      report.errors.push(`message_id_backfill ${company.slug}: no Message-ID found in the thread`);
      return false;
    }
    initial.providerMessageId = first.rfcMessageId;
    await deps.store.updateSend(initial.id, { providerMessageId: first.rfcMessageId });
    return true;
  } catch (error) {
    if (error instanceof GmailAuthError || error instanceof GmailTokenError) throw error;
    report.errors.push(`message_id_backfill ${company.slug}: ${describe(error)}`);
    return false;
  }
}

// ── (d) Sending ─────────────────────────────────────────────────────────────

async function sendDueMessages(deps: TickDeps, holder: string, senderEmail: string, report: TickReport): Promise<void> {
  let signature: MimeSignature;
  try {
    signature = deps.loadSignature();
  } catch (error) {
    if (!(error instanceof SignatureMissingError)) throw error;
    report.sendsRefused = `signature missing or empty. ${SIGNATURE_HINT}`;
    return;
  }

  const { gap_min_minutes: gapMin, gap_max_minutes: gapMax } = deps.config.outreach;
  const random = deps.random ?? Math.random;
  const horizon = deps.now().getTime() + (deps.lookaheadMinutes ?? DEFAULT_LOOKAHEAD_MINUTES) * MINUTE_MS;
  const due = (await deps.store.listSends({ statuses: ['scheduled'] }))
    .filter((send) => send.scheduledAt.getTime() <= horizon)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  // An `unknown` send may well have gone out, so it spaces the next one like a sent one (its time is when it was parked).
  const sentTimes = (await deps.store.listSends({ statuses: ['sent', 'unknown'] }))
    .map((send) => (send.sentAt ?? send.updatedAt).getTime());
  let lastSentAt = sentTimes.length > 0 ? Math.max(...sentTimes) : null;

  for (const send of due) {
    // The gap is enforced on the real send times, not the planned ones: after a missed trigger a burst of overdue
    // rows would otherwise go out back to back. Whatever does not fit before the horizon waits for the next tick.
    const gapMs = (gapMin + random() * (gapMax - gapMin)) * MINUTE_MS;
    const earliest = Math.max(send.scheduledAt.getTime(), lastSentAt === null ? 0 : lastSentAt + gapMs);
    if (earliest > horizon) break;

    const wait = earliest - deps.now().getTime();
    if (wait > 0) await deps.sleep(wait);
    if (!(await deps.store.renewLease(TICK_LEASE_NAME, holder, TICK_LEASE_TTL_MS))) throw new LeaseLostError();

    const outcome = await sendOne(deps, send, senderEmail, signature, report);
    if (outcome === 'sent') lastSentAt = deps.now().getTime();
    if (outcome === 'stop') break;
  }
}

type SendFailure = 'retry' | 'rejected' | 'unknown';

// Only a clean HTTP rejection proves the message was not sent. Anything murkier (a 5xx, a timeout, a dropped
// connection, an unreadable answer) might have gone out, so it must never be retried.
function classifySendError(error: unknown): SendFailure {
  if (error instanceof GmailApiError) {
    if (error.status === 429) return 'retry';
    if (error.status === 403 && error.reason !== undefined && RATE_LIMIT_REASONS.has(error.reason)) return 'retry';
    if (error.status >= 400 && error.status < 500 && error.status !== 408) return 'rejected';
  }
  return 'unknown';
}

type SendOutcome = 'sent' | 'skipped' | 'stop';

async function sendOne(
  deps: TickDeps,
  send: SendRecord,
  senderEmail: string,
  signature: MimeSignature,
  report: TickReport,
): Promise<SendOutcome> {
  const { store } = deps;
  const company = await store.getCompany(send.companyId);
  const expectedStatus = send.kind === 'initial' ? 'scheduled' : 'sent';
  if (!company || company.status !== expectedStatus) {
    await store.updateSend(send.id, { status: 'cancelled', error: `company is ${company?.status ?? 'gone'}` });
    report.cancelled += 1;
    return 'skipped';
  }

  const contact = await store.getContact(company.id);
  const draft = await store.getDraft(send.draftId);
  if (!contact || !draft) {
    await recordSendFailure(deps, send, 'draft or contact is missing');
    report.failed += 1;
    return 'skipped';
  }

  // Suppression is re-read now: a stop reply may have landed since the row was scheduled.
  if (await isSuppressed(store, company, contact.email)) {
    await store.updateSend(send.id, { status: 'cancelled', error: 'suppressed' });
    if (send.kind === 'initial') await store.updateCompany(company.id, { status: 'dropped', statusReason: 'suppressed' });
    report.cancelled += 1;
    return 'skipped';
  }

  let message;
  try {
    const initial =
      send.kind === 'follow_up'
        ? ((await store.listSends({ statuses: ['sent'] })).find((row) => row.draftId === send.draftId && row.kind === 'initial') ?? null)
        : null;
    message = buildOutgoingMessage({
      send,
      draft,
      initial,
      contact,
      sender: { name: deps.config.outreach.sender_name, email: senderEmail },
      signature,
      resume: send.kind === 'initial' ? await deps.readResume(draft.resumePdfPath) : null,
      now: deps.now(),
    });
  } catch (error) {
    // Nothing was sent: building failed. A missing resume or unthreadable follow-up will not fix itself.
    await recordSendFailure(deps, send, `cannot build message: ${describe(error)}`);
    report.failed += 1;
    if (!(error instanceof FollowUpNotThreadableError)) report.errors.push(`build ${send.kind}: ${describe(error)}`);
    return 'skipped';
  }

  // The access token is fetched before the row is claimed: if the token endpoint is down, nothing has been
  // touched and the row simply stays scheduled for the next tick (an error here must never read as "unknown").
  await deps.gmail.checkAccess();

  // Committed before the API call: a crash from here on leaves `sending`, never a silent resend.
  if (!(await store.claimSend(send.id))) return 'skipped';

  let sent: { id: string; threadId: string };
  try {
    sent = await deps.gmail.sendMessage({ raw: message.raw, threadId: message.threadId });
  } catch (error) {
    return handleSendError(deps, send, error, report);
  }

  // Gmail may rewrite the Message-ID we built; the follow-up must reference the one the recipient got.
  let providerMessageId: string | null = null;
  let note: string | null = null;
  try {
    providerMessageId = await deps.gmail.getRfcMessageId(sent.id);
    if (providerMessageId === null) note = 'Message-ID readback returned nothing';
  } catch (error) {
    note = error instanceof GmailAuthError ? 'Message-ID readback failed: authorization' : `Message-ID readback failed: ${describe(error)}`;
  }
  await completeSendWithRetry(deps, send, {
    sentAt: deps.now(),
    providerMessageId,
    providerThreadId: sent.threadId,
    error: note,
  });
  await store.recordEvent(company.id, 'send.sent', { sendId: send.id, kind: send.kind });
  report.sent += 1;
  return 'sent';
}

// The email is already out, so a database hiccup right here must not lose that fact. Retried with backoff; if the
// database stays down the error propagates, the row is left in `sending` and the stuck-sending sweep parks it as
// `unknown` (never resent), which is the honest state.
async function completeSendWithRetry(
  deps: TickDeps,
  send: SendRecord,
  result: Parameters<OutreachStore['completeSend']>[1],
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await deps.store.completeSend(send.id, result);
      return;
    } catch (error) {
      if (attempt >= COMPLETE_SEND_ATTEMPTS) throw error;
      await deps.sleep(COMPLETE_SEND_BACKOFF_MS * attempt);
    }
  }
}

async function handleSendError(deps: TickDeps, send: SendRecord, error: unknown, report: TickReport): Promise<SendOutcome> {
  if (error instanceof GmailAuthError || error instanceof GmailTokenError) {
    // The token failed before Gmail accepted anything: safe to put the row back and stop the tick.
    await deps.store.updateSend(send.id, { status: 'scheduled', error: 'authorization failed; will retry' });
    throw error;
  }
  const failure = classifySendError(error);
  if (failure === 'retry') {
    await deps.store.updateSend(send.id, { status: 'scheduled', error: `rate limited: ${describe(error)}` });
    report.retried += 1;
    return 'stop';
  }
  if (failure === 'rejected') {
    await recordSendFailure(deps, send, describe(error));
    report.failed += 1;
    report.errors.push(`send_rejected ${send.kind}: ${describe(error)}`);
    return 'skipped';
  }
  await markUnknown(deps, send, `outcome unknown: ${describe(error)}`);
  report.unknown += 1;
  report.errors.push(`send_unknown ${send.kind}: ${describe(error)}`);
  return 'skipped';
}

async function isSuppressed(store: OutreachStore, company: CompanyRecord, email: string): Promise<boolean> {
  const suppressions = await store.listSuppressions();
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return (
    suppressions.emails.some((entry) => entry.toLowerCase() === address) ||
    suppressions.domains.some((entry) => [domain, company.domain?.toLowerCase()].includes(entry.toLowerCase()))
  );
}

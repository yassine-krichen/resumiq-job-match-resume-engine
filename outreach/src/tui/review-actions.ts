import { nextSendSlot } from '../core/send-scheduler';
import type { OutreachStore } from '../db/outreach-store';
import { OutreachDraftSchema } from '../schemas/outreach';
import { occupiedSlots, recipientZoneFor, schedulerOptionsFor } from '../send/slot-planning';

import { isUnchanged } from './edit-document';
import type { EditableEmail } from './edit-document';
import { critiqueStoredDraft, isLowConfidence, toCriticDraft } from './review-items';
import type { ReviewContext, ReviewItem } from './review-items';

// What the keys do, against the store. Each returns a result for the notice line instead of throwing on a
// refusal, so the screen only has to show it.

export interface ActionResult {
  ok: boolean;
  message: string;
}

const KILLABLE = ['awaiting_review', 'approved', 'scheduled', 'needs_manual'] as const;
const EDITABLE = ['awaiting_review', 'needs_manual'] as const;

function explainBlockers(item: ReviewItem): string {
  const first = item.failures[0];
  const more = item.failures.length > 1 ? ` (+${item.failures.length - 1} more)` : '';
  return `${item.company.name}: ${first.rule}: ${first.detail}${more}. Fix it with e.`;
}

/** Approves one draft; a draft that breaks a rule, or is past review, is refused. */
export async function approveItem(store: OutreachStore, item: ReviewItem): Promise<ActionResult> {
  const { draft } = item;
  if (item.company.status === 'needs_manual') {
    return {
      ok: false,
      message: `${item.company.name} is needs_manual: press e to edit it, or a to approve anyway (it asks to confirm), or k to kill.`,
    };
  }
  if (!draft || item.company.status !== 'awaiting_review' || draft.status !== 'awaiting_review') {
    return { ok: false, message: `${item.company.name} is already ${item.company.status}` };
  }
  if (item.failures.length > 0) return { ok: false, message: explainBlockers(item) };
  await store.reviewDraft(item.company.id, draft.id, 'approved');
  return { ok: true, message: `approved ${item.company.name}` };
}

/**
 * Approves a `needs_manual` draft although a stage flagged it (the owner confirmed the reasons). The email rules
 * still apply: a draft that breaks one is refused here as well, and the reasons are kept in the event log.
 */
export async function approveDespite(store: OutreachStore, item: ReviewItem): Promise<ActionResult> {
  const { draft } = item;
  if (item.company.status !== 'needs_manual') return { ok: false, message: `${item.company.name} is ${item.company.status}, not needs_manual` };
  if (!draft) return { ok: false, message: `${item.company.name} has no draft to approve; only kill is possible` };
  if (draft.status !== 'awaiting_review') return { ok: false, message: `${item.company.name}: the draft is already ${draft.status}` };
  if (item.failures.length > 0) return { ok: false, message: explainBlockers(item) };
  await store.reviewDraft(item.company.id, draft.id, 'approved');
  await store.recordEvent(item.company.id, 'draft.approved_despite', { draftId: draft.id, reason: item.manualReason });
  return { ok: true, message: `approved ${item.company.name} despite the flagged reasons` };
}

function nameList(names: readonly string[]): string {
  return `${names.slice(0, 3).join(', ')}${names.length > 3 ? ', ...' : ''}`;
}

/**
 * Approves every awaiting draft that passes its email checks, was passed by the blind verifier (`isVerified`) and
 * has a contact the pipeline trusts. Drafts the verifier has not passed and low-confidence contacts are left for
 * an individual `a`, where the owner sees them; the result says how many were left and why.
 */
export async function approveAll(
  store: OutreachStore,
  items: readonly ReviewItem[],
  isVerified: (item: ReviewItem) => Promise<boolean>,
): Promise<ActionResult> {
  let approved = 0;
  const refused: string[] = [];
  const unverified: string[] = [];
  const lowConfidence: string[] = [];
  for (const item of items) {
    if (item.company.status !== 'awaiting_review') continue;
    if (isLowConfidence(item.contact)) lowConfidence.push(item.company.name);
    else if (!(await isVerified(item))) unverified.push(item.company.name);
    else if ((await approveItem(store, item)).ok) approved += 1;
    else refused.push(item.company.name);
  }
  const left = [
    refused.length > 0 ? `${refused.length} failed a check and were left: ${nameList(refused)}` : null,
    unverified.length > 0 ? `${unverified.length} not verified yet (approve individually): ${nameList(unverified)}` : null,
    lowConfidence.length > 0 ? `${lowConfidence.length} low-confidence contact (approve individually): ${nameList(lowConfidence)}` : null,
  ].filter((part): part is string => part !== null);
  return {
    ok: approved > 0 || left.length === 0,
    message: `approved ${approved}${left.map((part) => `; ${part}`).join('')}`,
  };
}

export async function killItem(store: OutreachStore, item: ReviewItem): Promise<ActionResult> {
  if (!(KILLABLE as readonly string[]).includes(item.company.status)) {
    return { ok: false, message: `${item.company.name} is ${item.company.status} and cannot be killed here` };
  }
  if (item.draft) await store.reviewDraft(item.company.id, item.draft.id, 'killed');
  else {
    // A company the research stopped on has no draft to mark: kill the company itself.
    await store.updateCompany(item.company.id, { status: 'killed', statusReason: null });
    await store.recordEvent(item.company.id, 'company.killed', { from: item.company.status });
  }
  return { ok: true, message: `killed ${item.company.name}` };
}

export function emailOf(item: ReviewItem): EditableEmail {
  if (!item.draft) throw new Error(`${item.company.name} has no draft to edit`);
  return { subject: item.draft.subject, body: item.draft.body, followUpBody: item.draft.followUpBody };
}

export type EditResult =
  | { ok: true; changed: boolean; message: string }
  | { ok: false; message: string; failures: string[] };

/**
 * Validates an edited email with the same rules the writer's draft went through (schema and critic) and, only if
 * all pass, stores it as a new draft version awaiting review. The resume is unchanged, so the bullet guard has
 * nothing to check. A failure stores nothing.
 */
export async function applyEdit(
  store: OutreachStore,
  item: ReviewItem,
  edited: EditableEmail,
  context: ReviewContext,
): Promise<EditResult> {
  const { draft } = item;
  if (!draft) return { ok: false, message: `${item.company.name} has no draft to edit`, failures: [] };
  if (!(EDITABLE as readonly string[]).includes(item.company.status)) {
    return { ok: false, message: `${item.company.name} is ${item.company.status}; only drafts awaiting review (or flagged needs_manual) can be edited`, failures: [] };
  }
  if (isUnchanged(emailOf(item), edited)) return { ok: true, changed: false, message: 'no changes' };

  const candidate = {
    ...toCriticDraft(draft),
    subject: edited.subject,
    body: edited.body,
    follow_up_body: edited.followUpBody,
  };
  const shape = OutreachDraftSchema.safeParse(candidate);
  if (!shape.success) {
    return {
      ok: false,
      message: 'the edit is not a valid email',
      failures: shape.error.issues.map((issue) => `${issue.path.join('.') || 'draft'}: ${issue.message}`),
    };
  }
  const failures = critiqueStoredDraft(shape.data, draft.language, item.company, item.dossier, context);
  if (failures.length > 0) {
    return { ok: false, message: 'the edit failed the email checks; nothing was saved', failures: failures.map((failure) => `${failure.rule}: ${failure.detail}`) };
  }

  // storeDraft also moves a needs_manual company back to awaiting_review; the next prepare-verify checks the new text.
  await store.storeDraft(item.company.id, {
    generic: draft.generic,
    language: draft.language,
    subject: edited.subject,
    body: edited.body,
    followUpBody: edited.followUpBody,
    cta: draft.cta,
    hookClaimId: draft.hookClaimId,
    followUpClaimId: draft.followUpClaimId ?? null,
    anchorPhrase: draft.anchorPhrase,
    mentionedProjects: draft.mentionedProjects,
    tailoring: draft.tailoring,
    resumeKind: draft.resumeKind,
    track: draft.track,
    resumePdfPath: draft.resumePdfPath,
  });
  await store.recordEvent(item.company.id, 'draft.edited', { fromVersion: draft.version, from: item.company.status });
  return { ok: true, changed: true, message: `saved edit for ${item.company.name}` };
}

export interface RetryDeps extends ReviewContext {
  now: () => Date;
  random?: () => number;
}

/**
 * Puts a failed send back in the queue: the same row (so the one-email-per-draft guarantee holds) goes back to
 * `scheduled` in a fresh slot under today's cap and gap rules, and the failure note on the company is cleared.
 * Only the owner decides this, because a failure (a 4xx, a missing resume) usually needs a fix first.
 */
export async function retryFailedSend(store: OutreachStore, item: ReviewItem, deps: RetryDeps): Promise<ActionResult> {
  const failed = item.failedSend;
  if (!failed) return { ok: false, message: `${item.company.name} has no failed send to retry` };
  const expected = failed.kind === 'initial' ? 'scheduled' : 'sent';
  if (item.company.status !== expected) {
    return { ok: false, message: `${item.company.name} is ${item.company.status} now; its failed send is no longer valid` };
  }

  const sends = await store.listSends();
  const now = deps.now();
  const slot = nextSendSlot({
    recipientZone: await recipientZoneFor(store, deps.config, item.company.id),
    notBefore: now,
    existingSlots: occupiedSlots(sends, failed.id),
    options: await schedulerOptionsFor(store, deps.config, sends, now),
    random: deps.random,
  });
  if (!(await store.requeueFailedSend(failed.id, slot))) {
    return { ok: false, message: `${item.company.name}: the send is no longer failed (someone else changed it); reload to see it` };
  }
  await store.updateCompany(item.company.id, { statusReason: null });
  await store.recordEvent(item.company.id, 'send.retry_requested', { sendId: failed.id, kind: failed.kind });
  return { ok: true, message: `${item.company.name}: ${failed.kind === 'initial' ? 'first email' : 'follow-up'} queued again` };
}

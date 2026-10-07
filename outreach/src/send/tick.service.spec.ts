import { DateTime } from 'luxon';

import type { SendRecord } from '../db/outreach-store';
import { FakeGmail } from '../testing/fake-gmail';
import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { seedDraft } from '../testing/seed';
import { loadExampleConfig } from '../testing/test-env';

import { GmailApiError, GmailAuthError, GmailNetworkError, GmailTokenError } from './gmail-client';
import { SignatureMissingError } from './signature';
import { runTick } from './tick.service';
import type { TickDeps, TickReport } from './tick.service';

// Monday 2026-10-12, 08:29 in Paris (06:29 UTC), one minute before the recipient window opens.
const START = new Date('2026-10-12T06:29:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SIGNATURE = { html: '<div>Jane Doe<br>Student</div>', text: 'Jane Doe\nStudent' };

interface Harness {
  store: InMemoryOutreachStore;
  gmail: FakeGmail;
  deps: TickDeps;
  setNow: (when: Date) => void;
  tick: () => Promise<TickReport>;
}

function harness(overrides: Partial<TickDeps> = {}): Harness {
  let current = START;
  const store = new InMemoryOutreachStore();
  store.clock = () => current;
  const gmail = new FakeGmail();
  const deps: TickDeps = {
    store,
    gmail,
    config: loadExampleConfig(),
    now: () => current,
    sleep: async (ms) => {
      current = new Date(current.getTime() + ms);
    },
    loadSignature: () => SIGNATURE,
    readResume: async () => Buffer.from('%PDF-1.4 fake'),
    // Always the minimum gap, so a full day's cap fits inside one send window.
    random: () => 0,
    ...overrides,
  };
  return {
    store,
    gmail,
    deps,
    setNow: (when) => {
      current = when;
    },
    tick: () => runTick(deps),
  };
}

function sendsOf(store: InMemoryOutreachStore, kind?: 'initial' | 'follow_up'): SendRecord[] {
  return store.sends.filter((send) => kind === undefined || send.kind === kind);
}

/** Records the clock at every Gmail send, so a test can read the real spacing. */
function recordSendTimes(h: Harness): number[] {
  const times: number[] = [];
  const original = h.gmail.sendMessage.bind(h.gmail);
  h.gmail.sendMessage = async (input) => {
    times.push(h.deps.now().getTime());
    return original(input);
  };
  return times;
}

/** A due, scheduled first email, inserted directly so a test controls its slot. */
async function dueRow(h: Harness, domain: string, scheduledAt: Date): Promise<SendRecord> {
  const { draft } = await seedDraft(h.store, domain, { decision: 'approved' });
  const row = await h.store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt });
  return row as SendRecord;
}

function header(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`^${name}: (.*)$`, 'mi'));
  return match ? match[1].trim() : null;
}

/** Sends the first email of one approved company; returns the harness ready for later ticks. */
async function sentInitial(): Promise<Harness & { companyId: string }> {
  const h = harness();
  const { company } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });
  await h.tick();
  expect(h.gmail.sent).toHaveLength(1);
  return { ...h, companyId: company.id };
}

describe('tick: scheduling', () => {
  it('schedules an approved draft in the recipient morning window and moves the company to scheduled', async () => {
    const h = harness({ sleep: async () => undefined, lookaheadMinutes: 0 });
    const { company } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });

    const report = await h.tick();

    expect(report.scheduled).toBe(1);
    const [send] = sendsOf(h.store, 'initial');
    const local = DateTime.fromJSDate(send.scheduledAt, { zone: 'Europe/Paris' });
    expect(local.hour * 60 + local.minute).toBeGreaterThanOrEqual(8 * 60 + 30);
    expect(local.hour * 60 + local.minute).toBeLessThan(10 * 60 + 30);
    expect((await h.store.getCompany(company.id))?.status).toBe('scheduled');
  });

  it('caps the first week at daily_cap_week1 and spills the rest to the next business day', async () => {
    const h = harness({ lookaheadMinutes: 0 });
    for (let i = 0; i < 25; i += 1) await seedDraft(h.store, `company-${i}.example`, { decision: 'approved' });

    await h.tick();

    const days = new Map<string, number>();
    for (const send of sendsOf(h.store)) {
      const day = DateTime.fromJSDate(send.scheduledAt, { zone: 'Africa/Tunis' }).toISODate() as string;
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    expect([...days.values()].sort((a, b) => b - a)).toEqual([20, 5]);
  });

  it('lifts the cap to daily_cap once a week has passed since the first send and nothing bounced', async () => {
    const h = harness({ lookaheadMinutes: 0 });
    const { draft } = await seedDraft(h.store, 'veteran.example', { decision: 'approved' });
    const long = await h.store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: new Date(START.getTime() - 8 * DAY) });
    await h.store.claimSend(long?.id as string);
    await h.store.completeSend(long?.id as string, {
      sentAt: new Date(START.getTime() - 8 * DAY),
      providerMessageId: '<old@mail.gmail.com>',
      providerThreadId: 'th-old',
    });
    for (let i = 0; i < 25; i += 1) await seedDraft(h.store, `company-${i}.example`, { decision: 'approved' });

    await h.tick();

    const today = sendsOf(h.store, 'initial').filter((send) => send.scheduledAt.getTime() > START.getTime() - DAY);
    expect(today).toHaveLength(25);
  });

  it('keeps the week-1 cap after a bounce even when a week has passed', async () => {
    const h = harness({ lookaheadMinutes: 0 });
    const { draft, company } = await seedDraft(h.store, 'bounced.example', { decision: 'approved' });
    const old = await h.store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: new Date(START.getTime() - 8 * DAY) });
    await h.store.claimSend(old?.id as string);
    await h.store.completeSend(old?.id as string, {
      sentAt: new Date(START.getTime() - 8 * DAY),
      providerMessageId: '<old@mail.gmail.com>',
      providerThreadId: 'th-old',
    });
    await h.store.recordInbound(company.id, { status: 'bounced', statusReason: 'delivery failure notice' });
    for (let i = 0; i < 25; i += 1) await seedDraft(h.store, `company-${i}.example`, { decision: 'approved' });

    await h.tick();

    const firstDay = sendsOf(h.store).filter(
      (send) => send.id !== old?.id && DateTime.fromJSDate(send.scheduledAt, { zone: 'Africa/Tunis' }).hasSame(DateTime.fromJSDate(START, { zone: 'Africa/Tunis' }), 'day'),
    );
    expect(firstDay).toHaveLength(20);
  });

  it('moves a slot missed by more than two hours to a later window instead of sending it', async () => {
    const h = harness({ lookaheadMinutes: 0 });
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    await h.tick();
    const [send] = sendsOf(h.store, 'initial');
    const missedBy = new Date(send.scheduledAt.getTime() + 3 * HOUR);
    h.setNow(missedBy);

    const report = await h.tick();

    expect(report.rescheduled).toBe(1);
    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store, 'initial')[0].scheduledAt.getTime()).toBeGreaterThan(missedBy.getTime());
  });
});

describe('tick: sending', () => {
  it('sleeps until the slot, sends the first email with signature and resume, and stores the Message-ID Gmail kept', async () => {
    const { store, gmail, companyId } = await sentInitial();

    const [send] = sendsOf(store, 'initial');
    expect(send.status).toBe('sent');
    expect(send.providerMessageId).toBe(gmail.sent[0].rfcMessageId);
    expect(send.providerMessageId).not.toBe(header(gmail.sent[0].raw, 'Message-ID'));
    expect(send.providerThreadId).toBe(gmail.sent[0].threadId);
    expect((await store.getCompany(companyId))?.status).toBe('sent');

    const raw = gmail.sent[0].raw;
    expect(raw).toContain('Content-Type: application/pdf');
    expect(raw).toContain('filename="Jane-Doe-Resume.pdf"');
    expect(raw).toContain('Jane Doe');
    expect(header(raw, 'In-Reply-To')).toBeNull();
    expect(gmail.sent[0].requestedThreadId).toBeUndefined();
  });

  it('spaces sends by at least the minimum gap across 5-minute ticks, sending only what is due in each', async () => {
    const h = harness({ random: () => 0.5 });
    for (let i = 0; i < 3; i += 1) await seedDraft(h.store, `company-${i}.example`, { decision: 'approved' });
    const times = recordSendTimes(h);

    for (let i = 0; i < 6; i += 1) {
      await h.tick();
      h.setNow(new Date(h.deps.now().getTime() + 5 * MINUTE));
    }

    expect(times).toHaveLength(3);
    expect((times[1] - times[0]) / MINUTE).toBeGreaterThanOrEqual(4);
    expect((times[2] - times[1]) / MINUTE).toBeGreaterThanOrEqual(4);
  });

  it('sends the follow-up in the same thread with In-Reply-To and References set to the stored Message-ID', async () => {
    const { store, gmail, tick, setNow } = await sentInitial();
    const [initial] = sendsOf(store, 'initial');
    setNow(new Date((initial.sentAt as Date).getTime() + HOUR));
    await tick();
    const [followUp] = sendsOf(store, 'follow_up');
    expect(followUp.status).toBe('scheduled');
    // 5 business days after Monday is the next Monday.
    expect(DateTime.fromJSDate(followUp.scheduledAt, { zone: 'Europe/Paris' }).toISODate()).toBe('2026-10-19');

    setNow(new Date(followUp.scheduledAt.getTime() - 2 * MINUTE));
    await tick();

    expect(gmail.sent).toHaveLength(2);
    const message = gmail.sent[1];
    expect(message.requestedThreadId).toBe(gmail.sent[0].threadId);
    expect(header(message.raw, 'In-Reply-To')).toBe(initial.providerMessageId);
    expect(header(message.raw, 'References')).toBe(initial.providerMessageId);
    expect(header(message.raw, 'Subject')).toMatch(/^Re: /);
    expect(message.raw).not.toContain('application/pdf');
    expect(message.raw).toContain('Jane Doe');
    expect(sendsOf(store, 'follow_up')[0].status).toBe('sent');
  });

  it('never sends a second email when a row already exists for the draft and kind', async () => {
    const { store, gmail, tick, setNow } = await sentInitial();
    setNow(new Date(START.getTime() + 2 * HOUR));
    await tick();
    await tick();

    expect(sendsOf(store, 'initial')).toHaveLength(1);
    expect(gmail.sent).toHaveLength(1);
  });

  it('refuses to send when the signature is missing and leaves the row scheduled', async () => {
    const h = harness({
      loadSignature: () => {
        throw new SignatureMissingError('No signature');
      },
    });
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });

    const report = await h.tick();

    expect(report.sendsRefused).toMatch(/signature/);
    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store)[0].status).toBe('scheduled');
  });

  it('cancels a scheduled send whose company was killed after scheduling', async () => {
    const h = harness({ lookaheadMinutes: 0 });
    const { company } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    await h.tick();
    await h.store.updateCompany(company.id, { status: 'killed' });
    h.deps.lookaheadMinutes = 120;

    await h.tick();

    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store)[0].status).toBe('cancelled');
  });

  it('cancels and drops a send when the address was suppressed after scheduling', async () => {
    const h = harness({ lookaheadMinutes: 0 });
    const { company } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    await h.tick();
    h.store.suppressions = { emails: ['claire@acme.example'], domains: [] };
    h.deps.lookaheadMinutes = 120;

    await h.tick();

    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store)[0].status).toBe('cancelled');
    expect((await h.store.getCompany(company.id))?.status).toBe('dropped');
  });

  it('cancels a send to a suppressed domain', async () => {
    const h = harness({ lookaheadMinutes: 0 });
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    await h.tick();
    h.store.suppressions = { emails: [], domains: ['acme.example'] };
    h.deps.lookaheadMinutes = 120;

    await h.tick();

    expect(h.gmail.sent).toHaveLength(0);
  });
});

describe('tick: failures', () => {
  it('parks a send whose outcome is unknown and never retries it', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailNetworkError('connection reset')];

    const first = await h.tick();
    expect(first.unknown).toBe(1);
    expect(sendsOf(h.store)[0].status).toBe('unknown');

    h.setNow(new Date(START.getTime() + DAY));
    await h.tick();
    h.setNow(new Date(START.getTime() + 2 * DAY));
    await h.tick();

    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store)[0].status).toBe('unknown');
  });

  it('treats a 5xx answer as unknown, because Gmail may have accepted the message', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailApiError('Gmail API 503', 503)];

    await h.tick();

    expect(sendsOf(h.store)[0].status).toBe('unknown');
  });

  it('turns a row stuck in sending for more than 15 minutes into unknown and does not send it', async () => {
    const h = harness({ lookaheadMinutes: 120 });
    const { draft } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    const row = await h.store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: START });
    await h.store.claimSend(row?.id as string);
    h.setNow(new Date(START.getTime() + 20 * MINUTE));

    const report = await h.tick();

    expect(report.unknown).toBe(1);
    expect(sendsOf(h.store)[0].status).toBe('unknown');
    expect(h.gmail.sent).toHaveLength(0);
  });

  it('leaves a row that has been sending for under 15 minutes alone', async () => {
    const h = harness({ lookaheadMinutes: 120 });
    const { draft } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    const row = await h.store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: START });
    await h.store.claimSend(row?.id as string);
    h.setNow(new Date(START.getTime() + 5 * MINUTE));

    await h.tick();

    expect(sendsOf(h.store)[0].status).toBe('sending');
  });

  it('marks a rejected request failed and does not retry it', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailApiError('Gmail API 400: Invalid To header', 400)];

    const report = await h.tick();
    h.setNow(new Date(START.getTime() + DAY));
    await h.tick();

    expect(report.failed).toBe(1);
    expect(sendsOf(h.store)[0].status).toBe('failed');
    expect(h.gmail.sent).toHaveLength(0);
  });

  it('puts a rate-limited send back to scheduled and stops sending for this tick', async () => {
    const h = harness({ lookaheadMinutes: 120 });
    await seedDraft(h.store, 'one.example', { decision: 'approved' });
    await seedDraft(h.store, 'two.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailApiError('Gmail API 429', 429)];

    const report = await h.tick();

    expect(report.retried).toBe(1);
    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store).every((send) => send.status === 'scheduled')).toBe(true);
  });

  it('reports an expired authorization, keeps the row scheduled and does not throw', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailAuthError('Gmail authorization expired (invalid_grant). Run: npm run outreach -- auth')];

    const report = await h.tick();

    expect(report.errors[0]).toMatch(/invalid_grant/);
    expect(sendsOf(h.store)[0].status).toBe('scheduled');
    expect(h.gmail.sent).toHaveLength(0);
  });

  it('finds the real Message-ID in the thread when the read-back after sending failed', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.readbackError = new GmailNetworkError('timeout');
    await h.tick();
    const [initial] = sendsOf(h.store, 'initial');
    expect(initial.status).toBe('sent');
    expect(initial.providerMessageId).toBeNull();

    h.gmail.readbackError = null;
    h.setNow(new Date(START.getTime() + HOUR));
    await h.tick();

    expect(sendsOf(h.store, 'initial')[0].providerMessageId).toBe(h.gmail.sent[0].rfcMessageId);
    expect(sendsOf(h.store, 'follow_up')).toHaveLength(1);
  });
});

describe('tick: replies and bounces', () => {
  async function withFollowUp(): Promise<Awaited<ReturnType<typeof sentInitial>>> {
    const h = await sentInitial();
    h.setNow(new Date(START.getTime() + HOUR));
    await h.tick();
    expect(sendsOf(h.store, 'follow_up')[0].status).toBe('scheduled');
    return h;
  }

  it('marks the company replied and cancels the scheduled follow-up when someone answers', async () => {
    const h = await withFollowUp();
    h.gmail.addIncoming(h.gmail.sent[0].threadId, 'Claire Martin <claire@acme.example>', 'Thanks, let us talk on Thursday.');
    h.setNow(new Date(START.getTime() + 2 * HOUR));

    const report = await h.tick();

    expect(report.replied).toBe(1);
    expect((await h.store.getCompany(h.companyId))?.status).toBe('replied');
    expect(sendsOf(h.store, 'follow_up')[0].status).toBe('cancelled');
    expect(h.store.suppressions.emails).toEqual([]);
  });

  it.each([
    ['Please stop emailing me.'],
    ['Unsubscribe me from this list'],
    ['I am not interested, thanks'],
    ['Merci de me désinscrire.'],
    ['Désolé, pas intéressé.'],
  ])('suppresses the address permanently when the reply says "%s"', async (snippet) => {
    const h = await withFollowUp();
    h.gmail.addIncoming(h.gmail.sent[0].threadId, 'claire@acme.example', snippet);
    h.setNow(new Date(START.getTime() + 2 * HOUR));

    const report = await h.tick();

    expect(report.optedOut).toBe(1);
    expect(h.store.suppressions.emails).toEqual(['claire@acme.example']);
    expect(sendsOf(h.store, 'follow_up')[0].status).toBe('cancelled');
  });

  it('marks the company bounced on a mailer-daemon notice and cancels the follow-up', async () => {
    const h = await withFollowUp();
    h.gmail.addIncoming(
      h.gmail.sent[0].threadId,
      'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      'Address not found. Your message wasn\'t delivered',
    );
    h.setNow(new Date(START.getTime() + 2 * HOUR));

    const report = await h.tick();

    expect(report.bounced).toBe(1);
    expect((await h.store.getCompany(h.companyId))?.status).toBe('bounced');
    expect(sendsOf(h.store, 'follow_up')[0].status).toBe('cancelled');
    expect(h.store.suppressions.emails).toEqual([]);
  });

  it('does not send the follow-up of a replied company even if its slot arrives in the same tick', async () => {
    const h = await withFollowUp();
    h.gmail.addIncoming(h.gmail.sent[0].threadId, 'claire@acme.example', 'Happy to chat');
    h.setNow(new Date(sendsOf(h.store, 'follow_up')[0].scheduledAt.getTime() - 5 * MINUTE));

    await h.tick();

    expect(h.gmail.sent).toHaveLength(1);
  });

  it('ignores its own messages when looking for a reply', async () => {
    const h = await withFollowUp();
    h.setNow(new Date(START.getTime() + 2 * HOUR));

    const report = await h.tick();

    expect(report.replied).toBe(0);
    expect((await h.store.getCompany(h.companyId))?.status).toBe('sent');
  });

  it('keeps going when one thread cannot be read and reports it', async () => {
    const h = await withFollowUp();
    h.gmail.threadError = new GmailApiError('Gmail API 500', 500);
    h.setNow(new Date(START.getTime() + 2 * HOUR));

    const report = await h.tick();

    expect(report.errors.some((entry) => entry.startsWith('thread_sync'))).toBe(true);
  });
});

describe('tick: spacing at send time', () => {
  it('spreads an overdue burst: one send per tick, never closer than the minimum gap', async () => {
    const h = harness({ random: () => 0 });
    for (let i = 0; i < 5; i += 1) await dueRow(h, `burst-${i}.example`, new Date(START.getTime() - 30 * MINUTE));
    const times = recordSendTimes(h);

    for (let i = 0; i < 8; i += 1) {
      await h.tick();
      h.setNow(new Date(h.deps.now().getTime() + 5 * MINUTE));
    }

    expect(times).toHaveLength(5);
    for (let i = 1; i < times.length; i += 1) expect((times[i] - times[i - 1]) / MINUTE).toBeGreaterThanOrEqual(4);
    // The first goes out immediately; none waits for the following tick longer than needed.
    expect(times[0]).toBe(START.getTime());
  });

  it('sends only one of an overdue burst in a single tick when the gap exceeds the horizon', async () => {
    // Jitter 0.5 puts the gap at 7.5 minutes, beyond the 4-minute horizon.
    const h = harness({ random: () => 0.5 });
    for (let i = 0; i < 3; i += 1) await dueRow(h, `burst-${i}.example`, new Date(START.getTime() - 10 * MINUTE));

    const report = await h.tick();

    expect(report.sent).toBe(1);
    expect(sendsOf(h.store).filter((send) => send.status === 'scheduled')).toHaveLength(2);
  });

  it('measures the gap from the last real send in the database, not from the planned slot', async () => {
    const h = harness({ random: () => 0 });
    const first = await dueRow(h, 'first.example', new Date(START.getTime() - HOUR));
    await h.store.claimSend(first.id);
    await h.store.completeSend(first.id, {
      sentAt: new Date(START.getTime() - 2 * MINUTE),
      providerMessageId: '<a@mail.gmail.com>',
      providerThreadId: 'th-a',
    });
    await dueRow(h, 'second.example', new Date(START.getTime() - 10 * MINUTE));
    const times = recordSendTimes(h);

    await h.tick();

    // Minimum gap 4 minutes after the send 2 minutes ago: wait 2 minutes, which fits in the 4-minute horizon.
    expect(times).toEqual([START.getTime() + 2 * MINUTE]);
  });

  it('counts a send of unknown outcome as sent for the gap: it may have gone out', async () => {
    const h = harness({ random: () => 0 });
    h.setNow(new Date(START.getTime() - 2 * MINUTE));
    const first = await dueRow(h, 'first.example', new Date(START.getTime() - HOUR));
    await h.store.claimSend(first.id);
    await h.store.updateSend(first.id, { status: 'unknown', error: 'outcome unknown: network cut' });
    h.setNow(START);
    await dueRow(h, 'second.example', new Date(START.getTime() - 10 * MINUTE));
    const times = recordSendTimes(h);

    await h.tick();

    // Minimum gap 4 minutes after the unknown send 2 minutes ago: wait 2 minutes.
    expect(times).toEqual([START.getTime() + 2 * MINUTE]);
  });

  it('leaves a send for the next tick when the gap would push it past the horizon', async () => {
    const h = harness({ random: () => 1 });
    const first = await dueRow(h, 'first.example', new Date(START.getTime() - HOUR));
    await h.store.claimSend(first.id);
    await h.store.completeSend(first.id, {
      sentAt: new Date(START.getTime() - 1 * MINUTE),
      providerMessageId: '<a@mail.gmail.com>',
      providerThreadId: 'th-a',
    });
    await dueRow(h, 'second.example', new Date(START.getTime() - 10 * MINUTE));

    const report = await h.tick();

    // Jitter is the maximum (11 minutes): the earliest slot is 10 minutes ahead, beyond the 4-minute horizon.
    expect(report.sent).toBe(0);
    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store, 'initial').filter((send) => send.status === 'scheduled')).toHaveLength(1);
  });

  it('after skipped triggers, sends overdue rows spaced and re-slots those missed by more than two hours', async () => {
    const h = harness({ random: () => 0 });
    const recent = await dueRow(h, 'recent.example', new Date(START.getTime() - 60 * MINUTE));
    const alsoRecent = await dueRow(h, 'also-recent.example', new Date(START.getTime() - 55 * MINUTE));
    const stale = await dueRow(h, 'stale.example', new Date(START.getTime() - 3 * HOUR));
    const times = recordSendTimes(h);
    let rescheduled = 0;

    for (let i = 0; i < 4; i += 1) {
      rescheduled += (await h.tick()).rescheduled;
      h.setNow(new Date(h.deps.now().getTime() + 5 * MINUTE));
    }

    // The stale row was moved to a fresh slot instead of being sent at its stale hour.
    expect(rescheduled).toBe(1);
    const byId = new Map(h.store.sends.map((send) => [send.id, send]));
    expect((byId.get(stale.id) as SendRecord).scheduledAt.getTime()).toBeGreaterThan(START.getTime() - HOUR);
    expect([recent, alsoRecent, stale].every((row) => byId.get(row.id)?.status === 'sent')).toBe(true);
    expect(times).toHaveLength(3);
    for (let i = 1; i < times.length; i += 1) expect((times[i] - times[i - 1]) / MINUTE).toBeGreaterThanOrEqual(4);
  });
});

describe('tick: lease', () => {
  it('does nothing when another tick holds an unexpired lease', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.store.leases.set('tick', { holder: 'someone-else', expiresAt: START.getTime() + 5 * MINUTE });

    const report = await h.tick();

    expect(report.skippedLocked).toBe(true);
    expect(h.store.sends).toHaveLength(0);
    expect(h.store.leases.get('tick')?.holder).toBe('someone-else');
  });

  it('takes over a lease that has expired (a crashed tick) and runs', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.store.leases.set('tick', { holder: 'crashed', expiresAt: START.getTime() - 1 });

    const report = await h.tick();

    expect(report.skippedLocked).toBe(false);
    expect(report.sent).toBe(1);
  });

  it('releases the lease at the end so the next trigger can run', async () => {
    const h = harness();
    await h.tick();

    expect(h.store.leases.has('tick')).toBe(false);
  });

  it('releases the lease even when the tick fails with an unexpected error', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.store.listSuppressions = async () => {
      throw new Error('database unreachable');
    };

    await expect(h.tick()).rejects.toThrow('database unreachable');
    expect(h.store.leases.has('tick')).toBe(false);
  });

  it('stops before the next send when the lease was taken over mid-tick', async () => {
    const h = harness({ lookaheadMinutes: 60, random: () => 0 });
    await dueRow(h, 'one.example', new Date(START.getTime() - MINUTE));
    await dueRow(h, 'two.example', new Date(START.getTime() - MINUTE));
    const original = h.gmail.sendMessage.bind(h.gmail);
    h.gmail.sendMessage = async (input) => {
      const result = await original(input);
      // The tick stalled past its lease: another process takes it over after the first send.
      h.store.leases.set('tick', { holder: 'other', expiresAt: h.deps.now().getTime() + HOUR });
      return result;
    };

    const report = await h.tick();

    expect(report.leaseLost).toBe(true);
    expect(report.sent).toBe(1);
    expect(h.gmail.sent).toHaveLength(1);
    expect(h.store.leases.get('tick')?.holder).toBe('other');
  });

  it('does not release a lease it no longer owns', async () => {
    const h = harness({ lookaheadMinutes: 60 });
    await dueRow(h, 'one.example', new Date(START.getTime() - MINUTE));
    h.gmail.sendMessage = async () => {
      h.store.leases.set('tick', { holder: 'other', expiresAt: h.deps.now().getTime() + HOUR });
      throw new GmailNetworkError('reset');
    };
    await h.tick();

    expect(h.store.leases.get('tick')?.holder).toBe('other');
  });
});

describe('tick: access token problems never read as unknown', () => {
  it('leaves the row untouched and stops when the token cannot be fetched before claiming', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.accessErrors = [new GmailTokenError('token endpoint returned 503')];

    const report = await h.tick();

    expect(report.errors[0]).toMatch(/gmail_token/);
    expect(h.gmail.sent).toHaveLength(0);
    expect(sendsOf(h.store)[0].status).toBe('scheduled');
    expect(report.unknown).toBe(0);
  });

  it('sends on the next tick once the token endpoint is back', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.accessErrors = [new GmailTokenError('token endpoint returned 503')];
    await h.tick();

    h.setNow(new Date(START.getTime() + 5 * MINUTE));
    await h.tick();

    expect(h.gmail.sent).toHaveLength(1);
  });

  it('puts the row back to scheduled when the token fails inside the send request', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailTokenError('could not get an access token: socket hang up')];

    const report = await h.tick();

    expect(report.errors[0]).toMatch(/gmail_token/);
    expect(sendsOf(h.store)[0].status).toBe('scheduled');
    expect(report.unknown).toBe(0);
  });
});

describe('tick: failures that need a person', () => {
  it('records why on the company when Gmail rejects a send, so the review screen can show it', async () => {
    const h = harness();
    const { company } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailApiError('Gmail API 400: Invalid To header', 400)];

    await h.tick();

    expect(sendsOf(h.store)[0].status).toBe('failed');
    expect((await h.store.getCompany(company.id))?.statusReason).toMatch(/initial send failed: Gmail API 400/);
  });

  it('records why on the company when the message cannot be built (resume missing)', async () => {
    const h = harness({
      readResume: async () => {
        throw new Error('Resume file not found: storage/x.pdf');
      },
    });
    const { company } = await seedDraft(h.store, 'acme.example', { decision: 'approved' });

    await h.tick();

    expect(sendsOf(h.store)[0].status).toBe('failed');
    expect((await h.store.getCompany(company.id))?.statusReason).toMatch(/Resume file not found/);
  });

  it.each(['userRateLimitExceeded', 'rateLimitExceeded'])(
    'treats a 403 %s like a 429: back to scheduled, tick stops',
    async (reason) => {
      const h = harness();
      await seedDraft(h.store, 'acme.example', { decision: 'approved' });
      h.gmail.sendErrors = [new GmailApiError('Gmail API 403: Rate Limit Exceeded', 403, reason)];

      const report = await h.tick();

      expect(report.retried).toBe(1);
      expect(sendsOf(h.store)[0].status).toBe('scheduled');
    },
  );

  it('treats any other 403 as a rejection, not a retry', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.sendErrors = [new GmailApiError('Gmail API 403: Insufficient Permission', 403, 'insufficientPermissions')];

    const report = await h.tick();

    expect(report.failed).toBe(1);
    expect(sendsOf(h.store)[0].status).toBe('failed');
  });
});

describe('tick: recording a send that went out', () => {
  it('retries completeSend and still records the send when the database recovers', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    const original = h.store.completeSend.bind(h.store);
    let failures = 2;
    h.store.completeSend = async (id, result) => {
      if (failures-- > 0) throw new Error('connection terminated');
      return original(id, result);
    };

    const report = await h.tick();

    expect(report.sent).toBe(1);
    expect(sendsOf(h.store)[0].status).toBe('sent');
    expect(h.gmail.sent).toHaveLength(1);
  });

  it('gives up after three attempts, leaves the row sending and never resends it', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    let attempts = 0;
    h.store.completeSend = async () => {
      attempts += 1;
      throw new Error('connection terminated');
    };

    await expect(h.tick()).rejects.toThrow('connection terminated');
    expect(attempts).toBe(3);
    expect(sendsOf(h.store)[0].status).toBe('sending');

    // A later tick parks it as unknown once it is stuck; the email is never sent a second time.
    h.setNow(new Date(START.getTime() + 20 * MINUTE));
    await h.tick();
    expect(sendsOf(h.store)[0].status).toBe('unknown');
    expect(h.gmail.sent).toHaveLength(1);
  });
});

describe('tick: follow-up Message-ID backfill', () => {
  it('reports it when the thread has no Message-ID to backfill from', async () => {
    const h = harness();
    await seedDraft(h.store, 'acme.example', { decision: 'approved' });
    h.gmail.readbackError = new GmailNetworkError('timeout');
    await h.tick();
    h.gmail.readbackError = null;
    // The thread lost its own message: nothing carries the Message-ID.
    h.gmail.threads.set(h.gmail.sent[0].threadId, []);
    h.setNow(new Date(START.getTime() + HOUR));

    const report = await h.tick();

    expect(report.errors.some((entry) => entry.startsWith('message_id_backfill'))).toBe(true);
    expect(sendsOf(h.store, 'follow_up')).toHaveLength(0);
  });
});

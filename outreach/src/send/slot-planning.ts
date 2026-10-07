import type { AppConfig } from '../config/app-config';
import { schedulerOptionsFromConfig } from '../core/send-scheduler';
import type { SchedulerOptions } from '../core/send-scheduler';
import type { OutreachStore, SendRecord } from '../db/outreach-store';

import { effectiveDailyCap } from './daily-cap';

// What both the tick and the review screen's retry need to place a send in a fresh slot.

const ACTIVE_SLOT_STATUSES: readonly string[] = ['scheduled', 'sending', 'sent', 'unknown'];

function slotOf(send: SendRecord): Date {
  return send.sentAt ?? send.scheduledAt;
}

/** Every instant already taken for the gap and cap rules. A failed or cancelled send holds no slot. */
export function occupiedSlots(sends: readonly SendRecord[], exceptId?: string): Date[] {
  return sends.filter((send) => send.id !== exceptId && ACTIVE_SLOT_STATUSES.includes(send.status)).map(slotOf);
}

/** The recipient's timezone from the dossier, else the configured fallback. */
export async function recipientZoneFor(store: OutreachStore, config: AppConfig, companyId: string): Promise<string> {
  const dossier = await store.getLatestDossier(companyId);
  return dossier?.data.timezone ?? config.fallbackTimezone;
}

/** Scheduler options with today's cap: week-1 cap until a week after the first send, and after any bounce. */
export async function schedulerOptionsFor(
  store: OutreachStore,
  config: AppConfig,
  sends: readonly SendRecord[],
  now: Date,
): Promise<SchedulerOptions> {
  const { outreach } = config;
  const firstSent = sends
    .filter((send) => send.status === 'sent' && send.sentAt !== null)
    .map((send) => (send.sentAt as Date).getTime());
  const bounced = await store.listCompanies({ statuses: ['bounced'] });
  const dailyCap = effectiveDailyCap({
    now,
    firstSentAt: firstSent.length > 0 ? new Date(Math.min(...firstSent)) : null,
    hadBounce: bounced.length > 0,
    week1Cap: outreach.daily_cap_week1,
    cap: outreach.daily_cap,
  });
  return { ...schedulerOptionsFromConfig(outreach), dailyCap };
}

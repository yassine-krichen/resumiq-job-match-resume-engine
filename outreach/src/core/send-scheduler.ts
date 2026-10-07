import { DateTime } from 'luxon';

import type { OutreachConfig } from '../schemas/outreach';

// Pure scheduling: no clock, no DB, no randomness unless injected. The tick
// script feeds it "now" and every slot already scheduled or sent.

/** The cap is a per-mailbox-owner limit, so its "day" is the owner's, not the recipient's. */
export const DEFAULT_CAP_ZONE = 'Africa/Tunis';

export interface SchedulerOptions {
  /** Recipient-local sending window, HH:MM 24h. */
  window: { start: string; end: string };
  /** Minimum and maximum minutes between any two sends, whatever their recipients' zones. */
  gapMinMinutes: number;
  gapMaxMinutes: number;
  dailyCap: number;
  /** Zone whose calendar day the cap is counted in. */
  capZone?: string;
}

export interface NextSlotInput {
  recipientZone: string;
  /** Earliest acceptable instant; usually "now". */
  notBefore: Date;
  /** Every initial and follow-up send already scheduled or sent, excluding the one being (re)scheduled. */
  existingSlots: readonly Date[];
  options: SchedulerOptions;
  /** Returns [0, 1); injectable for deterministic tests. */
  random?: () => number;
}

const MAX_ITERATIONS = 1000;

export function schedulerOptionsFromConfig(config: OutreachConfig): SchedulerOptions {
  return {
    window: config.send_window,
    gapMinMinutes: config.gap_min_minutes,
    gapMaxMinutes: config.gap_max_minutes,
    dailyCap: config.daily_cap,
  };
}

function isBusinessDay(day: DateTime): boolean {
  return day.weekday <= 5;
}

function windowBounds(day: DateTime, window: SchedulerOptions['window']): { start: DateTime; end: DateTime } {
  const at = (clock: string): DateTime => {
    const [hour, minute] = clock.split(':').map(Number);
    return day.set({ hour, minute, second: 0, millisecond: 0 });
  };
  return { start: at(window.start), end: at(window.end) };
}

/** Earliest instant >= `instant` that is inside a recipient-local business-day window. */
function alignToWindow(instant: DateTime, window: SchedulerOptions['window']): DateTime {
  let candidate = instant;
  for (let i = 0; i < 14; i += 1) {
    const day = candidate.startOf('day');
    if (isBusinessDay(day)) {
      const { start, end } = windowBounds(day, window);
      if (candidate < end) return candidate < start ? start : candidate;
    }
    candidate = day.plus({ days: 1 });
  }
  throw new Error('Could not find a business day within 14 days');
}

function validZone(zone: string): string {
  if (!DateTime.local().setZone(zone).isValid) throw new Error(`Invalid timezone "${zone}"`);
  return zone;
}

/**
 * Next send time: the recipient's next business-day morning window, at least
 * `gapMinMinutes` from every other send (the actual gap after a neighbour is
 * random within the configured range), and under the daily cap counted in the
 * cap zone's calendar day.
 */
export function nextSendSlot(input: NextSlotInput): Date {
  const { options, existingSlots } = input;
  const random = input.random ?? Math.random;
  const recipientZone = validZone(input.recipientZone);
  const capZone = validZone(options.capZone ?? DEFAULT_CAP_ZONE);
  const minGapMs = options.gapMinMinutes * 60_000;
  const existingMs = existingSlots.map((slot) => slot.getTime());

  let candidate = DateTime.fromJSDate(input.notBefore, { zone: recipientZone });

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    candidate = alignToWindow(candidate, options.window);

    const capDay = candidate.setZone(capZone).startOf('day');
    const sentThatDay = existingMs.filter((ms) => DateTime.fromMillis(ms, { zone: capZone }).hasSame(capDay, 'day'));
    if (sentThatDay.length >= options.dailyCap) {
      candidate = capDay.plus({ days: 1 }).setZone(recipientZone);
      continue;
    }

    const candidateMs = candidate.toMillis();
    const neighbour = existingMs.find((ms) => Math.abs(ms - candidateMs) < minGapMs);
    if (neighbour !== undefined) {
      const gapMinutes = options.gapMinMinutes + random() * (options.gapMaxMinutes - options.gapMinMinutes);
      candidate = DateTime.fromMillis(neighbour + gapMinutes * 60_000, { zone: recipientZone });
      continue;
    }
    return candidate.toJSDate();
  }
  throw new Error('Could not find a free send slot');
}

/** True when a scheduled slot is more than the grace period in the past: reschedule it instead of sending at night. */
export function isSlotMissed(scheduledAt: Date, now: Date, graceMinutes = 120): boolean {
  return now.getTime() - scheduledAt.getTime() > graceMinutes * 60_000;
}

/** Adds Monday-to-Friday days in the given zone (no public holidays). */
export function addBusinessDays(from: Date, zone: string, businessDays: number): DateTime {
  let day = DateTime.fromJSDate(from, { zone: validZone(zone) });
  let remaining = businessDays;
  while (remaining > 0) {
    day = day.plus({ days: 1 });
    if (isBusinessDay(day)) remaining -= 1;
  }
  return day;
}

export interface FollowUpSlotInput extends Omit<NextSlotInput, 'notBefore'> {
  sentAt: Date;
  businessDays: number;
}

/** Follow-up slot: N business days after the first email (recipient-local), at the start of the sending window or later. */
export function nextFollowUpSlot(input: FollowUpSlotInput): Date {
  const due = addBusinessDays(input.sentAt, input.recipientZone, input.businessDays).startOf('day');
  return nextSendSlot({ ...input, notBefore: due.toJSDate() });
}

// SPEC section 7: a gentle first week, then the full cap while nothing has bounced.

export const DEFAULT_WEEK1_CAP = 20;
export const RAMP_DAYS = 7;

export interface DailyCapInput {
  now: Date;
  /** When the very first email went out; null while nothing has been sent. */
  firstSentAt: Date | null;
  hadBounce: boolean;
  /** `daily_cap_week1` from the config. */
  week1Cap?: number;
  /** `daily_cap` from the config; the ceiling in every phase. */
  cap: number;
}

export function effectiveDailyCap(input: DailyCapInput): number {
  const week1 = Math.min(input.week1Cap ?? DEFAULT_WEEK1_CAP, input.cap);
  if (input.firstSentAt === null || input.hadBounce) return week1;
  const rampEnds = input.firstSentAt.getTime() + RAMP_DAYS * 24 * 60 * 60_000;
  return input.now.getTime() < rampEnds ? week1 : input.cap;
}

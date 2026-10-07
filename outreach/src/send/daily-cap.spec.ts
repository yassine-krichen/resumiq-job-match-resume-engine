import { effectiveDailyCap } from './daily-cap';

const DAY = 24 * 60 * 60_000;
const now = new Date('2026-10-20T08:00:00Z');

describe('effectiveDailyCap', () => {
  it('uses the week-1 cap before anything has been sent', () => {
    expect(effectiveDailyCap({ now, firstSentAt: null, hadBounce: false, week1Cap: 20, cap: 30 })).toBe(20);
  });

  it('uses the week-1 cap during the first 7 days after the first send', () => {
    const firstSentAt = new Date(now.getTime() - 6 * DAY);
    expect(effectiveDailyCap({ now, firstSentAt, hadBounce: false, week1Cap: 20, cap: 30 })).toBe(20);
  });

  it('lifts to the full cap after 7 days with no bounce', () => {
    const firstSentAt = new Date(now.getTime() - 7 * DAY);
    expect(effectiveDailyCap({ now, firstSentAt, hadBounce: false, week1Cap: 20, cap: 30 })).toBe(30);
  });

  it('stays at the week-1 cap after a bounce', () => {
    const firstSentAt = new Date(now.getTime() - 30 * DAY);
    expect(effectiveDailyCap({ now, firstSentAt, hadBounce: true, week1Cap: 20, cap: 30 })).toBe(20);
  });

  it('defaults the week-1 cap to 20 and never exceeds daily_cap', () => {
    expect(effectiveDailyCap({ now, firstSentAt: null, hadBounce: false, cap: 30 })).toBe(20);
    expect(effectiveDailyCap({ now, firstSentAt: null, hadBounce: false, week1Cap: 20, cap: 10 })).toBe(10);
  });
});

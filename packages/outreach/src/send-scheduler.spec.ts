import { DateTime } from 'luxon';

import { addBusinessDays, isSlotMissed, nextFollowUpSlot, nextSendSlot } from './send-scheduler';
import type { SchedulerOptions } from './send-scheduler';

const PACIFIC = 'America/Los_Angeles';
const PARIS = 'Europe/Paris';

const options: SchedulerOptions = {
  window: { start: '08:30', end: '10:30' },
  gapMinMinutes: 4,
  gapMaxMinutes: 11,
  dailyCap: 20,
};

// Always the minimum gap, so expectations are exact.
const minGap = (): number => 0;

function iso(value: string): Date {
  return new Date(value);
}

function local(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toFormat('yyyy-MM-dd HH:mm');
}

describe('nextSendSlot', () => {
  it('moves to 08:30 in the recipient timezone when it is still night there (US/Pacific)', () => {
    // Tuesday 2026-10-06 12:00 UTC is 05:00 in San Francisco.
    const slot = nextSendSlot({ recipientZone: PACIFIC, notBefore: iso('2026-10-06T12:00:00Z'), existingSlots: [], options });

    expect(local(slot, PACIFIC)).toBe('2026-10-06 08:30');
    expect(slot.toISOString()).toBe('2026-10-06T15:30:00.000Z');
  });

  it('keeps the current time when it is already inside the recipient window', () => {
    const now = iso('2026-10-06T16:15:00Z'); // 09:15 Pacific

    expect(nextSendSlot({ recipientZone: PACIFIC, notBefore: now, existingSlots: [], options })).toEqual(now);
  });

  it('moves to the next morning when the window has already closed', () => {
    const slot = nextSendSlot({
      recipientZone: PACIFIC,
      notBefore: iso('2026-10-06T18:00:00Z'), // 11:00 Pacific
      existingSlots: [],
      options,
    });

    expect(local(slot, PACIFIC)).toBe('2026-10-07 08:30');
  });

  it('skips the weekend: Friday after the window goes to Monday, and Saturday goes to Monday', () => {
    const friday = nextSendSlot({
      recipientZone: PACIFIC,
      notBefore: iso('2026-10-09T20:00:00Z'), // Friday 13:00 Pacific
      existingSlots: [],
      options,
    });
    const saturday = nextSendSlot({
      recipientZone: PACIFIC,
      notBefore: iso('2026-10-10T17:00:00Z'),
      existingSlots: [],
      options,
    });

    expect(local(friday, PACIFIC)).toBe('2026-10-12 08:30');
    expect(local(saturday, PACIFIC)).toBe('2026-10-12 08:30');
  });

  it('follows daylight saving: 08:30 is 16:30 UTC after the US clocks go back', () => {
    const slot = nextSendSlot({
      recipientZone: PACIFIC,
      notBefore: iso('2026-11-02T00:00:00Z'),
      existingSlots: [],
      options,
    });

    expect(slot.toISOString()).toBe('2026-11-02T16:30:00.000Z');
  });

  it('keeps at least the minimum gap after an existing send, whatever the recipient zone', () => {
    const first = iso('2026-10-06T15:30:00Z'); // 08:30 Pacific

    const second = nextSendSlot({ recipientZone: PACIFIC, notBefore: first, existingSlots: [first], options, random: minGap });

    expect(second.getTime() - first.getTime()).toBe(4 * 60_000);
  });

  it('spaces sends by a random gap within the configured range', () => {
    const first = iso('2026-10-06T15:30:00Z');

    const second = nextSendSlot({ recipientZone: PACIFIC, notBefore: first, existingSlots: [first], options, random: () => 0.999 });

    const gapMinutes = (second.getTime() - first.getTime()) / 60_000;
    expect(gapMinutes).toBeGreaterThanOrEqual(4);
    expect(gapMinutes).toBeLessThanOrEqual(11);
  });

  it('keeps the gap against a send that is later than the candidate, even for another zone', () => {
    // A Paris send already sits at 08:32 Pacific-equivalent time; the Pacific slot at 08:30 must clear it.
    const parisSlot = iso('2026-10-06T15:32:00Z');

    const slot = nextSendSlot({ recipientZone: PACIFIC, notBefore: iso('2026-10-06T15:30:00Z'), existingSlots: [parisSlot], options, random: minGap });

    expect(slot.getTime() - parisSlot.getTime()).toBe(4 * 60_000);
  });

  it('rolls over to the next day when the daily cap is reached', () => {
    // Tuesday 06:30 UTC is 08:30 in Paris and 07:30 in Tunis.
    const sentToday = [iso('2026-10-06T06:30:00Z'), iso('2026-10-06T06:40:00Z')];

    const slot = nextSendSlot({
      recipientZone: PARIS,
      notBefore: iso('2026-10-06T06:00:00Z'),
      existingSlots: sentToday,
      options: { ...options, dailyCap: 2 },
      random: minGap,
    });

    expect(local(slot, PARIS)).toBe('2026-10-07 08:30');
  });

  it('counts the daily cap in the Tunis calendar day, not the UTC day', () => {
    // 23:30 UTC on Oct 6 is already Oct 7 in Tunis (UTC+1), so it counts against the Oct 7 cap.
    const lateSend = iso('2026-10-06T23:30:00Z');

    const slot = nextSendSlot({
      recipientZone: PARIS,
      notBefore: iso('2026-10-07T00:00:00Z'),
      existingSlots: [lateSend],
      options: { ...options, dailyCap: 1 },
    });

    expect(local(slot, PARIS)).toBe('2026-10-08 08:30');
  });

  it('counts follow-ups and first emails alike toward the cap', () => {
    const slots = Array.from({ length: 3 }, (_, i) => new Date(Date.UTC(2026, 9, 6, 6, 30 + i * 5)));

    const slot = nextSendSlot({
      recipientZone: PARIS,
      notBefore: iso('2026-10-06T06:00:00Z'),
      existingSlots: slots,
      options: { ...options, dailyCap: 3 },
    });

    expect(local(slot, PARIS)).toBe('2026-10-07 08:30');
  });

  it('pushes a full window to the next business day instead of landing after the window closes', () => {
    // 2-hour window with a 60-minute fixed gap holds three sends; the fourth must wait for tomorrow.
    const tight: SchedulerOptions = { ...options, gapMinMinutes: 60, gapMaxMinutes: 60 };
    const existing = [iso('2026-10-06T06:30:00Z'), iso('2026-10-06T07:30:00Z'), iso('2026-10-06T08:30:00Z')];

    const slot = nextSendSlot({ recipientZone: PARIS, notBefore: iso('2026-10-06T06:00:00Z'), existingSlots: existing, options: tight, random: minGap });

    expect(local(slot, PARIS)).toBe('2026-10-07 08:30');
  });

  it('rejects an invalid timezone', () => {
    expect(() => nextSendSlot({ recipientZone: 'Mars/Olympus', notBefore: new Date(), existingSlots: [], options })).toThrow(
      /Invalid timezone/,
    );
  });
});

describe('isSlotMissed', () => {
  const slot = iso('2026-10-06T08:30:00Z');

  it('is false within the two-hour grace period and true beyond it', () => {
    expect(isSlotMissed(slot, iso('2026-10-06T10:30:00Z'))).toBe(false);
    expect(isSlotMissed(slot, iso('2026-10-06T10:31:00Z'))).toBe(true);
  });

  it('is false for a slot that is still in the future', () => {
    expect(isSlotMissed(slot, iso('2026-10-06T08:00:00Z'))).toBe(false);
  });
});

describe('addBusinessDays', () => {
  it('adds weekdays only, so Thursday plus two lands on Monday', () => {
    const result = addBusinessDays(iso('2026-10-08T12:00:00Z'), PARIS, 2);

    expect(result.toFormat('yyyy-MM-dd cccc')).toBe('2026-10-12 Monday');
  });
});

describe('nextFollowUpSlot', () => {
  it('lands 5 business days after the first email, at the start of the recipient window', () => {
    // Sent Tuesday 09:30 Pacific.
    const slot = nextFollowUpSlot({
      sentAt: iso('2026-10-06T16:30:00Z'),
      businessDays: 5,
      recipientZone: PACIFIC,
      existingSlots: [],
      options,
    });

    expect(local(slot, PACIFIC)).toBe('2026-10-13 08:30');
  });

  it('counts 5 business days across a weekend: Friday plus 5 is the next Friday', () => {
    const slot = nextFollowUpSlot({
      sentAt: iso('2026-10-09T16:30:00Z'),
      businessDays: 5,
      recipientZone: PACIFIC,
      existingSlots: [],
      options,
    });

    expect(local(slot, PACIFIC)).toBe('2026-10-16 08:30');
  });

  it('still honours the gap and the cap', () => {
    const taken = iso('2026-10-13T15:30:00Z'); // 08:30 Pacific on the due day

    const slot = nextFollowUpSlot({
      sentAt: iso('2026-10-06T16:30:00Z'),
      businessDays: 5,
      recipientZone: PACIFIC,
      existingSlots: [taken],
      options,
      random: minGap,
    });

    expect(slot.getTime() - taken.getTime()).toBe(4 * 60_000);
  });
});

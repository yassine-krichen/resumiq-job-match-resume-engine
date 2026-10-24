import { extractNumbers, isRoundingOfAny, numberKey, numberSet } from './numbers';

const values = (text: string): number[] => extractNumbers(text).map((n) => n.value);

describe('extractNumbers', () => {
  it('expands k and M suffixes and thousands separators to the same value', () => {
    expect(values('served 10k users')).toEqual([10_000]);
    expect(values('served 10,000 users')).toEqual([10_000]);
    expect(values('a 1.5M row table')).toEqual([1_500_000]);
  });

  it('reads percentages, multipliers and decimals', () => {
    expect(values('cut latency by 30%')).toEqual([30]);
    expect(values('a 3.8x speedup')).toEqual([3.8]);
    expect(values('p95 of 20.4ms')).toEqual([20.4]);
  });

  it('returns each side of a range separately', () => {
    expect(values('ingesting 100-268 page documents')).toEqual([100, 268]);
  });

  it('ignores digits embedded in identifiers', () => {
    expect(values('built on S3 and OAuth2 with ES2022')).toEqual([]);
  });

  it('returns nothing for text without numbers', () => {
    expect(extractNumbers('Led the platform team')).toEqual([]);
  });
});

describe('numberKey and numberSet', () => {
  it('treats 10k and 10,000 as the same key', () => {
    expect(numberSet('10k users')).toEqual(numberSet('10,000 users'));
    expect(numberKey(0.1 + 0.2)).toBe(numberKey(0.3));
  });
});

describe('isRoundingOfAny', () => {
  it('accepts a coarser rounding of a pooled number', () => {
    expect(isRoundingOfAny(60, ['60.1'])).toBe(true);
    expect(isRoundingOfAny(150, ['148'])).toBe(true);
  });

  it('rejects a figure that is more precise than the nearby pooled number', () => {
    expect(isRoundingOfAny(87.3, ['90'])).toBe(false);
  });

  it('rejects an exact match (already supported) and unrelated values', () => {
    expect(isRoundingOfAny(60, ['60'])).toBe(false);
    expect(isRoundingOfAny(42, ['7', '1000'])).toBe(false);
  });
});

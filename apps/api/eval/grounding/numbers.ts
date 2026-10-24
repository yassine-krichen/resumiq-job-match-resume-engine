export interface NumberToken {
  raw: string;
  value: number;
}

const NUMBER_RE =
  /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?%|([kKmMbB])(?![A-Za-z])|x(?![A-Za-z])|×)?/g;
const MULTIPLIER: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** Extracts numeric tokens, expanding 10k / 1.5M style suffixes. */
export function extractNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const whole = m[1].replace(/,/g, '');
    const value = Number(`${whole}${m[2] ?? ''}`) * (m[3] ? MULTIPLIER[m[3].toLowerCase()] : 1);
    if (Number.isFinite(value)) out.push({ raw: m[0].trim(), value });
  }
  return out;
}

export const numberKey = (value: number): string => String(Number(value.toPrecision(10)));

export function numberSet(text: string): Set<string> {
  return new Set(extractNumbers(text).map((n) => numberKey(n.value)));
}

function significantDigits(value: number): number {
  const mantissa = Math.abs(value).toExponential().split('e')[0].replace('.', '');
  return Math.max(1, mantissa.replace(/0+$/, '').length);
}

/**
 * True when `value` is a coarser rounding of some pooled number (60 for 60.1,
 * 150 for 148). A value that is *more* precise than the nearby pooled number
 * (87.3 vs 90) is not a rounding, it is an invented figure.
 */
export function isRoundingOfAny(value: number, pool: Iterable<string>): boolean {
  const digits = significantDigits(value);
  for (const k of pool) {
    const p = Number(k);
    if (p !== value && p !== 0 && Number(p.toPrecision(digits)) === value) return true;
  }
  return false;
}

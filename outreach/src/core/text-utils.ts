// Shared text helpers for the verifier, the bullet guard and the critic, so all
// three agree on what "the same text" and "the same number" mean.

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u02BC`\u00B4]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F]/g;
// French guillemets are typeset with inner (non-breaking) spaces that a plain
// quote mark does not have, so the spaces go with them.
const OPENING_GUILLEMET = /\u00AB\s*/g;
const CLOSING_GUILLEMET = /\s*\u00BB/g;
const DASHES = /[\u2010-\u2015\u2212]/g;

/**
 * Canonical form for verbatim comparisons: NFKC (folds NBSP, narrow NBSP,
 * ellipsis, ligatures), curly quotes/guillemets and dash variants unified,
 * invisible characters removed, whitespace collapsed, case-insensitive.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(OPENING_GUILLEMET, '"')
    .replace(CLOSING_GUILLEMET, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

// A number glued to a letter is part of a name (S3, k8s, OAuth2, v2), not a claim.
// ".5" is a number; "1.2.3" is one version-like token.
const NUMBER_TOKEN = /(?<![\p{L}\p{N}.,])(?:\d+(?:[.,]\d+)*|\.\d+)/gu;

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '') || '0';
}

function canonicalNumber(token: string): string {
  let raw = token;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) raw = raw.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(raw)) raw = raw.replace(',', '.');

  const separators = raw.match(/[.,]/g) ?? [];
  if (separators.length > 1) return raw.replace(/,/g, '.').split('.').map(stripLeadingZeros).join('.');

  const [integerPart, fraction = ''] = raw.split('.');
  const decimals = fraction.replace(/0+$/, '');
  const integer = stripLeadingZeros(integerPart);
  return decimals ? `${integer}.${decimals}` : integer;
}

/** Numbers found in the text, canonicalised ("1,200" and "1200" are equal, "08" and "8" too). */
export function extractNumbers(text: string): string[] {
  const matches = text.normalize('NFKC').match(NUMBER_TOKEN) ?? [];
  return matches.map(canonicalNumber);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `needle` occurs in `haystack` as whole words (so "stage" is not in "backstage", "Acme" not in "Acmesoft"); same normalisation as normalizeForMatch. */
export function containsWord(haystack: string, needle: string): boolean {
  const wanted = normalizeForMatch(needle);
  if (wanted === '') return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(wanted)}(?![\\p{L}\\p{N}])`, 'u').test(normalizeForMatch(haystack));
}

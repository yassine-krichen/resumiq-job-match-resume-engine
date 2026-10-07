import type { ContactConfidence, EmailSource } from '../schemas/outreach';

import { emailDomain } from './normalize-input';
import { escapeRegExp, normalizeForMatch } from './text-utils';

// Where a sourced contact address came from decides how much the reviewer should trust it.

/** Hunter scores each address 0-100; below this it is treated like a guess. */
export const HUNTER_NORMAL_CONFIDENCE = 80;

export function contactConfidence(source: EmailSource, hunterConfidence: number | null = null): ContactConfidence {
  if (source === 'page_quote') return 'normal';
  if (source === 'hunter') return hunterConfidence !== null && hunterConfidence >= HUNTER_NORMAL_CONFIDENCE ? 'normal' : 'low';
  return 'low';
}

/**
 * True when the quote holds the address as a whole token: "ceo-jobs@acme.fr" is not "jobs@acme.fr" and
 * "jobs@acme.fr.uk" is not "jobs@acme.fr". Same normalisation as the quote verifier.
 */
export function quoteContainsEmail(quote: string, email: string): boolean {
  const wanted = normalizeForMatch(email);
  if (wanted === '') return false;
  const pattern = new RegExp(`(?<![a-z0-9._%+-])${escapeRegExp(wanted)}(?![a-z0-9_-]|\\.[a-z0-9])`);
  return pattern.test(normalizeForMatch(quote));
}

// Second-level labels that sit under a country code (acme.co.uk, acme.com.tn). Not the public suffix list:
// a miss only makes two hosts look different, which downgrades confidence instead of trusting too much.
const COUNTRY_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'or', 'ne', 'go']);

/** "careers.eu.acme.com" -> "acme.com", "team.acme.co.uk" -> "acme.co.uk". */
export function registrableDomain(host: string): string {
  const labels = host.trim().toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && COUNTRY_SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function registrableHostOf(url: string): string | null {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * A quoted address is only as good as the page it was read on. It stays `normal` when the page belongs to the
 * address's own domain or to the website the candidate names; an address found on a directory or any third-party
 * page may be stale or belong to someone else, so it is downgraded to `low` for the reviewer.
 */
export function pageQuoteConfidence(input: {
  email: string;
  /** The URL the page was requested from and the one it ended on; either may match. */
  pageUrls: readonly string[];
  website?: string;
}): ContactConfidence {
  const trusted = new Set([registrableDomain(emailDomain(input.email))]);
  const website = input.website ? registrableHostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.website) ? input.website : `https://${input.website}`) : null;
  if (website) trusted.add(website);
  return input.pageUrls.some((url) => {
    const host = registrableHostOf(url);
    return host !== null && trusted.has(host);
  })
    ? 'normal'
    : 'low';
}

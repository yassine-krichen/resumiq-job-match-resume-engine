import type { OutreachClaim } from '../schemas/outreach';

import { normalizeForMatch } from './text-utils';

export type ClaimRejection = 'unsafe_snapshot_id' | 'snapshot_missing' | 'url_mismatch' | 'quote_not_found';

export interface VerifyClaimsResult {
  verified: OutreachClaim[];
  rejected: Array<{ claim: OutreachClaim; reason: ClaimRejection }>;
}

/** A saved page: its text plus where it was fetched from (the snapshot script's metadata). */
export interface SnapshotRecord {
  text: string;
  /** The URL that was requested. */
  url: string;
  /** The URL after redirects, when it differs. */
  finalUrl?: string;
}

/**
 * Loads a snapshot by id. The implementation must resolve only ids listed in
 * the run's snapshot manifest (never build a path from the id alone) and
 * return null for anything else.
 */
export type SnapshotLoader = (snapshotId: string) => Promise<SnapshotRecord | null> | SnapshotRecord | null;

// Snapshot ids become file names under the run's snapshot folder, and the
// researcher agent (which reads untrusted web pages) chooses them. Only a plain
// file-name-shaped token is accepted: no separators, no drive letters, no "..",
// no leading or trailing dot.
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Reserved on Windows whatever the extension ("NUL.txt" opens the null device).
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function isSafeSnapshotId(snapshotId: string): boolean {
  return (
    SAFE_SNAPSHOT_ID.test(snapshotId) &&
    !snapshotId.includes('..') &&
    !snapshotId.endsWith('.') &&
    !WINDOWS_DEVICE_NAME.test(snapshotId)
  );
}

/** True when the quote occurs in the snapshot text, ignoring case, spacing and typographic variants. */
export function quoteAppearsInSnapshot(snapshotText: string, quote: string): boolean {
  const needle = normalizeForMatch(quote);
  return needle.length > 0 && normalizeForMatch(snapshotText).includes(needle);
}

/** Scheme, "www.", host case, fragment and trailing slash do not make a different page; path and query do. */
function canonicalUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}${url.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function urlMatchesClaim(record: SnapshotRecord, claimUrl: string): boolean {
  const wanted = canonicalUrl(claimUrl);
  return [record.url, record.finalUrl].some((url) => url !== undefined && canonicalUrl(url) === wanted);
}

/**
 * Keeps only the claims whose verbatim quote exists in the saved snapshot they
 * cite, and whose snapshot was really fetched from the claim's URL. Without the
 * URL check the researcher could attach a true quote from one page to a claim
 * it cites to another. `loadSnapshot` is never called with an unsafe id.
 */
export async function verifyClaims(
  claims: readonly OutreachClaim[],
  loadSnapshot: SnapshotLoader,
): Promise<VerifyClaimsResult> {
  const verified: OutreachClaim[] = [];
  const rejected: VerifyClaimsResult['rejected'] = [];

  for (const claim of claims) {
    if (!isSafeSnapshotId(claim.snapshot_id)) {
      rejected.push({ claim, reason: 'unsafe_snapshot_id' });
      continue;
    }
    const record = await loadSnapshot(claim.snapshot_id);
    if (record === null) {
      rejected.push({ claim, reason: 'snapshot_missing' });
    } else if (!urlMatchesClaim(record, claim.url)) {
      rejected.push({ claim, reason: 'url_mismatch' });
    } else if (!quoteAppearsInSnapshot(record.text, claim.quote)) {
      rejected.push({ claim, reason: 'quote_not_found' });
    } else {
      verified.push(claim);
    }
  }
  return { verified, rejected };
}

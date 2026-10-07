import type { NormalizedRow } from './normalize-input';

export type DuplicateReason =
  | 'duplicate_in_list'
  | 'already_in_database'
  | 'suppressed_email'
  | 'suppressed_domain';

/** Sets or arrays of strings; compared case-insensitively, so callers need not lowercase. */
export interface DedupeExclusions {
  /** Domain keys already present in the DB for this user. */
  existingDomainKeys?: Iterable<string>;
  /** Addresses that asked to stop. */
  suppressedEmails?: Iterable<string>;
  /** Domains that asked to stop; their subdomains are blocked too. */
  suppressedDomains?: Iterable<string>;
}

export interface DedupeResult {
  kept: NormalizedRow[];
  dropped: Array<{ row: NormalizedRow; reason: DuplicateReason }>;
}

function lowerSet(values: Iterable<string> | undefined): Set<string> {
  return new Set([...(values ?? [])].map((value) => value.trim().toLowerCase()));
}

interface NormalizedExclusions {
  existingDomainKeys: Set<string>;
  suppressedEmails: Set<string>;
  suppressedDomains: Set<string>;
}

function isOnSuppressedDomain(domain: string, suppressed: ReadonlySet<string>): boolean {
  const labels = domain.split('.');
  // "cs.acme.com" is blocked by "acme.com"; "notacme.com" is not.
  return labels.some((_, index) => suppressed.has(labels.slice(index).join('.')));
}

function reasonToDrop(
  row: NormalizedRow,
  exclusions: NormalizedExclusions,
  seen: ReadonlySet<string>,
): DuplicateReason | null {
  if (exclusions.suppressedEmails.has(row.email)) return 'suppressed_email';
  if (row.domain !== null && isOnSuppressedDomain(row.domain, exclusions.suppressedDomains)) {
    return 'suppressed_domain';
  }
  if (exclusions.existingDomainKeys.has(row.domainKey)) return 'already_in_database';
  if (seen.has(row.domainKey)) return 'duplicate_in_list';
  return null;
}

/**
 * Keeps the first row per domain key and drops rows already in the DB or on
 * the suppression list. Suppression is checked first: a suppressed address
 * must never be reported as merely "already known".
 */
export function dedupeRows(rows: readonly NormalizedRow[], exclusions: DedupeExclusions = {}): DedupeResult {
  const normalized: NormalizedExclusions = {
    existingDomainKeys: lowerSet(exclusions.existingDomainKeys),
    suppressedEmails: lowerSet(exclusions.suppressedEmails),
    suppressedDomains: lowerSet(exclusions.suppressedDomains),
  };
  const seen = new Set<string>();
  const kept: NormalizedRow[] = [];
  const dropped: DedupeResult['dropped'] = [];

  for (const row of rows) {
    const reason = reasonToDrop(row, normalized, seen);
    if (reason) {
      dropped.push({ row, reason });
      continue;
    }
    seen.add(row.domainKey);
    kept.push(row);
  }
  return { kept, dropped };
}

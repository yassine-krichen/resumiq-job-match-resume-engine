import { dedupeRows } from '../core/dedupe';
import type { DuplicateReason } from '../core/dedupe';
import { checkEmail } from '../core/email-check';
import type { EmailCheckResult } from '../core/email-check';
import { normalizeRows } from '../core/normalize-input';
import type { InvalidRow, NormalizedRow } from '../core/normalize-input';
import { DuplicateCompanyError } from '../db/outreach-store';
import type { OutreachStore } from '../db/outreach-store';
import type { ContactConfidence, EmailSource } from '../schemas/outreach';

import { RunLayout, readJsonFile, slugForDomainKey, writeJsonAtomic } from './run-layout';

export type MxChecker = (email: string) => Promise<EmailCheckResult>;

/** How a sourced address was found, keyed by the lowercased address; stored on the contact. */
export type SourcedContactFacts = ReadonlyMap<string, { emailSource: EmailSource; contactConfidence: ContactConfidence }>;

export interface IngestDeps {
  store: OutreachStore;
  layout: RunLayout;
  /** Set by `ingest-sourced` only. */
  sourcedContacts?: SourcedContactFacts;
  /** Defaults to a real MX lookup; pass one that returns mx 'unchecked' to stay offline. */
  checkMx?: MxChecker;
}

export interface IngestedCompany {
  slug: string;
  company: string;
  email: string;
  mx: EmailCheckResult['mx'];
  roleAccount: boolean;
}

export interface IngestReport {
  runId: string;
  total: number;
  inserted: IngestedCompany[];
  dropped: Array<{ company: string; email: string; reason: DuplicateReason | 'mx_none' | 'invalid_email_syntax' }>;
  invalid: InvalidRow[];
}

const MX_CONCURRENCY = 8;

async function checkInBatches(rows: readonly NormalizedRow[], check: MxChecker): Promise<EmailCheckResult[]> {
  const results: EmailCheckResult[] = [];
  for (let start = 0; start < rows.length; start += MX_CONCURRENCY) {
    const batch = rows.slice(start, start + MX_CONCURRENCY);
    results.push(...(await Promise.all(batch.map((row) => check(row.email)))));
  }
  return results;
}

/**
 * Adds rows to runs/<id>/normalized.json, the record of every list this run was
 * given. An ingest into an existing run (a corrected row, a second file)
 * appends instead of overwriting; identical rows are not repeated.
 */
export async function appendNormalizedRows(layout: RunLayout, rows: readonly unknown[]): Promise<void> {
  const existing = await readJsonFile(layout.normalizedFile);
  const earlier = existing.status === 'ok' && Array.isArray(existing.value) ? existing.value : [];
  const seen = new Set(earlier.map((row) => JSON.stringify(row)));
  const added = rows.filter((row) => !seen.has(JSON.stringify(row)));
  await writeJsonAtomic(layout.normalizedFile, [...earlier, ...added]);
}

async function appendIngestReport(layout: RunLayout, report: IngestReport): Promise<void> {
  const existing = await readJsonFile(layout.ingestReportFile);
  const earlier =
    existing.status === 'ok' && Array.isArray((existing.value as { reports?: unknown }).reports)
      ? ((existing.value as { reports: unknown[] }).reports)
      : [];
  await writeJsonAtomic(layout.ingestReportFile, { reports: [...earlier, report] });
}

/**
 * Validates the agent-written rows, drops duplicates (inside the list, already
 * in the DB, suppressed) and addresses whose domain cannot receive mail, then
 * inserts the rest as `ingested` companies. Idempotent: running it twice on
 * the same file inserts nothing the second time.
 */
export async function ingestRows(deps: IngestDeps, rawRows: readonly unknown[]): Promise<IngestReport> {
  const { store, layout } = deps;
  const checkMx = deps.checkMx ?? ((email: string) => checkEmail(email));

  const { valid, invalid } = normalizeRows(rawRows);
  const [existing, suppressions] = await Promise.all([store.listDomainKeys(), store.listSuppressions()]);
  const { kept, dropped } = dedupeRows(valid, {
    existingDomainKeys: existing,
    suppressedEmails: suppressions.emails,
    suppressedDomains: suppressions.domains,
  });

  const report: IngestReport = {
    runId: layout.runId,
    total: rawRows.length,
    inserted: [],
    dropped: dropped.map(({ row, reason }) => ({ company: row.company, email: row.email, reason })),
    invalid,
  };

  const checks = await checkInBatches(kept, checkMx);
  for (const [index, row] of kept.entries()) {
    const check = checks[index];
    if (!check.syntaxValid) {
      report.dropped.push({ company: row.company, email: row.email, reason: 'invalid_email_syntax' });
      continue;
    }
    // 'unknown' (a failed lookup) keeps the lead; only a definitive "no mail" drops it.
    if (check.mx === 'none') {
      report.dropped.push({ company: row.company, email: row.email, reason: 'mx_none' });
      continue;
    }

    const slug = slugForDomainKey(row.domainKey);
    try {
      await store.insertCompany({
        runId: layout.runId,
        slug,
        name: row.company,
        domain: row.domain,
        domainKey: row.domainKey,
        website: row.website ?? null,
        contact: {
          email: row.email,
          name: row.name ?? null,
          role: row.role ?? null,
          roleAccount: check.roleAccount,
          mxStatus: check.mx,
          ...(deps.sourcedContacts?.get(row.email) ?? {}),
        },
      });
    } catch (error) {
      // Another ingest won the race for this domain between the check and the insert.
      if (error instanceof DuplicateCompanyError) {
        report.dropped.push({ company: row.company, email: row.email, reason: 'already_in_database' });
        continue;
      }
      throw error;
    }
    await writeJsonAtomic(layout.companyFile(slug, 'input'), {
      company: row.company,
      email: row.email,
      name: row.name ?? null,
      role: row.role ?? null,
      website: row.website ?? null,
      notes: row.notes ?? null,
      domain: row.domain,
      role_account: check.roleAccount,
    });
    report.inserted.push({ slug, company: row.company, email: row.email, mx: check.mx, roleAccount: check.roleAccount });
  }

  await appendIngestReport(layout, report);
  await store.recordEvent(null, 'ingest.finished', {
    runId: layout.runId,
    inserted: report.inserted.length,
    dropped: report.dropped.length,
    invalid: report.invalid.length,
  });
  return report;
}

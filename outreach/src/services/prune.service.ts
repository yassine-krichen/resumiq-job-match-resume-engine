import { rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { OutreachPaths } from '../config/paths';
import type { CompanyRecord, CompanyStatus, OutreachStore } from '../db/outreach-store';

import { isInside, isValidRunId } from './run-layout';

// Retention (SPEC section 11): a lead that is dead for good keeps no personal data. The company row stays
// as a tombstone (domain key + status) so the same domain is never researched or emailed again, and the
// suppression list is never touched.

/** Dead ends: rejected by the owner, dropped by the pipeline, or emailed and never answered. */
export const PRUNABLE_STATUSES: readonly CompanyStatus[] = ['killed', 'dropped', 'sent'];
export const DEFAULT_PRUNE_DAYS = 180;
/**
 * A sent lead can still answer for the reply watch (21 days after the last send) and its follow-up goes out about
 * 5 business days (7 days) after the first email, so nothing younger than this may be erased.
 */
export const MIN_PRUNE_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;
// Same shape as the slugs `slugForDomainKey` makes; checked again because it becomes a path.
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export interface PruneInput {
  store: OutreachStore;
  paths: OutreachPaths;
  days: number;
  /** Report what would happen and change nothing. */
  dryRun: boolean;
  now?: () => Date;
}

export interface PruneReport {
  days: number;
  dryRun: boolean;
  cutoff: string;
  pruned: Array<{ slug: string; name: string; runId: string; status: CompanyStatus; ageDays: number }>;
  /** Companies that qualify by status and age but still have a send waiting to go out. */
  skippedActiveSends: number;
  /** Companies erased by an earlier prune (no contact left). */
  alreadyPruned: number;
  removedRunFolders: string[];
}

async function removeIfPresent(root: string, target: string): Promise<void> {
  // The ids come from the DB; never delete anything that resolves outside the folder it belongs to.
  if (!isInside(root, target) || target === root) return;
  await rm(target, { recursive: true, force: true });
}

async function removeIfEmpty(folder: string): Promise<void> {
  try {
    await rmdir(folder);
  } catch {
    // Not empty (another company's resumes, or the shared track resumes) or already gone: leave it.
  }
}

async function removeCompanyFiles(paths: OutreachPaths, company: CompanyRecord): Promise<void> {
  if (!isValidRunId(company.runId) || !SLUG.test(company.slug)) return;
  await removeIfPresent(paths.runsDir, join(paths.runsDir, company.runId, 'companies', company.slug));
  await removeIfPresent(paths.storageDir, join(paths.storageDir, company.runId, company.slug));
  await removeIfEmpty(join(paths.storageDir, company.runId));
}

export async function pruneDeadLeads(input: PruneInput): Promise<PruneReport> {
  const { store, paths, days, dryRun } = input;
  if (!Number.isInteger(days) || days < MIN_PRUNE_DAYS) {
    throw new Error(`--days must be a whole number of at least ${MIN_PRUNE_DAYS}: a sent lead can still reply or get its follow-up before that`);
  }
  const now = (input.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - days * DAY_MS);

  const report: PruneReport = {
    days,
    dryRun,
    cutoff: cutoff.toISOString(),
    pruned: [],
    skippedActiveSends: 0,
    alreadyPruned: 0,
    removedRunFolders: [],
  };

  const stale = (await store.listCompanies({ statuses: PRUNABLE_STATUSES })).filter((company) => company.updatedAt < cutoff);
  const waiting = new Set(
    (await store.listSends({ statuses: ['scheduled', 'sending'] })).map((send) => send.companyId),
  );

  const toPrune: CompanyRecord[] = [];
  for (const company of stale) {
    if ((await store.getContact(company.id)) === null) report.alreadyPruned += 1;
    else if (waiting.has(company.id)) report.skippedActiveSends += 1;
    else toPrune.push(company);
  }

  const touchedRuns = new Set<string>();
  for (const company of toPrune) {
    report.pruned.push({
      slug: company.slug,
      name: company.name,
      runId: company.runId,
      status: company.status,
      ageDays: Math.floor((now.getTime() - company.updatedAt.getTime()) / DAY_MS),
    });
    touchedRuns.add(company.runId);
    if (dryRun) continue;
    await store.pruneCompanyData(company.id);
    await removeCompanyFiles(paths, company);
  }

  // A run folder also holds the lists the run was given (emails, names): remove it with its last company.
  const prunedIds = new Set(toPrune.map((company) => company.id));
  for (const runId of touchedRuns) {
    const companies = await store.listCompanies({ runId });
    const finished = await Promise.all(
      companies.map(async (company) => prunedIds.has(company.id) || (await store.getContact(company.id)) === null),
    );
    if (!finished.every(Boolean) || !isValidRunId(runId)) continue;
    report.removedRunFolders.push(runId);
    if (!dryRun) await removeIfPresent(paths.runsDir, join(paths.runsDir, runId));
  }
  return report;
}

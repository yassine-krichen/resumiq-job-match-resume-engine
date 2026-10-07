import { rm } from 'node:fs/promises';

import { z } from 'zod';

import type { AppConfig } from '../config/app-config';
import { buildCandidateFacts, buildConfigLines, evaluateVerification, sentencesOfDraft } from '../core/draft-verification';
import type { VerificationIssue, VerifyInput } from '../core/draft-verification';
import { normalizeForMatch } from '../core/text-utils';
import type { CompanyRecord, DossierRecord, DraftRecord, OutreachStore } from '../db/outreach-store';
import type { MasterDB } from '../resume/master-db';

import { RunLayout, readJsonFile, writeJsonAtomic } from './run-layout';
import { loadManifestSnapshotTexts } from './snapshot.service';

// Phase 4: after the drafts exist (written or generic), a blind verifier agent re-checks every
// sentence against the sources it may rest on. `prepareVerify` writes what the agent may read,
// `processVerify` turns its verdicts into a decision. A sentence that states a fact without a
// source sends the company to needs_manual, with the sentence as the reason.

export interface VerifyStageDeps {
  store: OutreachStore;
  layout: RunLayout;
  config: AppConfig;
  db: MasterDB;
}

export type VerifyOutcome = 'verified' | 'needs_manual' | 'retry' | 'missing';

export interface VerifyStageReport {
  runId: string;
  results: Array<{ slug: string; outcome: VerifyOutcome; detail?: string }>;
}

// One try plus one retry; a verifier that gives nothing usable twice is not trusted with the draft.
const MAX_ATTEMPTS = 2;
const REASON_SENTENCE_CHARS = 90;
const REASON_MAX_SENTENCES = 3;

const ReportSchema = z.object({ draftId: z.string() });
const PassedReportSchema = z.object({ draftId: z.string(), outcome: z.literal('verified') });
const ErrorsSchema = z.object({ draftId: z.string(), attempt: z.number().int().min(1) });

interface PendingItem {
  company: CompanyRecord;
  draft: DraftRecord;
}

async function pendingItems({ store, layout }: Pick<VerifyStageDeps, 'store' | 'layout'>): Promise<PendingItem[]> {
  const companies = await store.listCompanies({ runId: layout.runId, statuses: ['awaiting_review'] });
  const items: PendingItem[] = [];
  for (const company of companies) {
    const draft = await store.getLatestDraft(company.id);
    if (!draft) continue;
    const report = await readJsonFile(layout.companyFile(company.slug, 'verify-report'));
    const parsed = report.status === 'ok' ? ReportSchema.safeParse(report.value) : null;
    // A report for an older draft version (the owner edited it, a retry rewrote it) does not cover this one.
    if (parsed?.success && parsed.data.draftId === draft.id) continue;
    items.push({ company, draft });
  }
  return items;
}

/** True when the verifier passed exactly this draft version (a flagged or edited draft is not). */
export async function isDraftVerified(layout: RunLayout, slug: string, draftId: string): Promise<boolean> {
  const read = await readJsonFile(layout.companyFile(slug, 'verify-report'));
  const parsed = read.status === 'ok' ? PassedReportSchema.safeParse(read.value) : null;
  return parsed?.success === true && parsed.data.draftId === draftId;
}

/** Slugs whose latest draft has not been verified yet (the basis of `pending --stage verify`). */
export async function pendingVerifySlugs(store: OutreachStore, layout: RunLayout): Promise<string[]> {
  return (await pendingItems({ store, layout })).map((item) => item.company.slug);
}

const trimTrailingStops = (text: string): string => normalizeForMatch(text).replace(/[.\s]+$/, '');

// The generic email may carry the researcher's one-liner, but only when the text really occurs in a saved
// page (createGenericDraft checks that). Offered to the verifier as a source so a legitimate generic draft
// is not sent to the owner for it.
async function oneLinerSource(
  layout: RunLayout,
  company: CompanyRecord,
  draft: DraftRecord,
  dossier: DossierRecord | null,
): Promise<VerifyInput['verified_claims']> {
  const oneLiner = dossier?.data.one_liner;
  if (!draft.generic || !oneLiner) return [];
  const needle = trimTrailingStops(oneLiner);
  if (needle === '' || !normalizeForMatch(draft.body).includes(needle)) return [];
  const pages = (await loadManifestSnapshotTexts(layout.snapshotsDir(company.slug))).map(normalizeForMatch);
  return pages.some((page) => page.includes(needle)) ? [{ id: 'one_liner', text: oneLiner, quote: oneLiner }] : [];
}

/** Built from the DB each time, so what the verifier saw and what the script judges can never drift apart. */
async function buildVerifyInput(deps: VerifyStageDeps, { company, draft }: PendingItem): Promise<VerifyInput> {
  const dossier = await deps.store.getLatestDossier(company.id);
  // The stored dossier holds verified claims only; its other fields (one-liner, stack, fit) stay out.
  const claims = draft.generic ? [] : (dossier?.data.claims ?? []).map(({ id, text, quote }) => ({ id, text, quote }));
  return {
    language: draft.language,
    company: company.name,
    sentences: sentencesOfDraft(draft.body, draft.followUpBody),
    verified_claims: [...claims, ...(await oneLinerSource(deps.layout, company, draft, dossier))],
    candidate_facts: buildCandidateFacts(deps.db, deps.config),
    config_lines: buildConfigLines(deps.config, draft.language),
  };
}

/** Writes verify-input.json for every unverified draft of the run and removes any earlier verify.json. */
export async function prepareVerify(deps: VerifyStageDeps): Promise<{ runId: string; slugs: string[] }> {
  const items = await pendingItems(deps);
  for (const item of items) {
    await writeJsonAtomic(deps.layout.companyFile(item.company.slug, 'verify-input'), await buildVerifyInput(deps, item));
    await rm(deps.layout.companyFile(item.company.slug, 'verify'), { force: true });
  }
  return { runId: deps.layout.runId, slugs: items.map((item) => item.company.slug) };
}

function reasonFor(issues: readonly VerificationIssue[]): string {
  const shown = issues
    .slice(0, REASON_MAX_SENTENCES)
    .map((issue) => {
      const text = issue.text.length > REASON_SENTENCE_CHARS ? `${issue.text.slice(0, REASON_SENTENCE_CHARS)}...` : issue.text;
      return `"${text}" (${issue.reason.replace('_', ' ')})`;
    })
    .join('; ');
  const more = issues.length > REASON_MAX_SENTENCES ? `; and ${issues.length - REASON_MAX_SENTENCES} more` : '';
  return `blind verifier: ${issues.length} sentence(s) without a supporting source: ${shown}${more}`;
}

async function attemptNumber(layout: RunLayout, slug: string, draftId: string): Promise<number> {
  const read = await readJsonFile(layout.companyFile(slug, 'verify-errors'));
  const parsed = read.status === 'ok' ? ErrorsSchema.safeParse(read.value) : null;
  return parsed?.success && parsed.data.draftId === draftId ? parsed.data.attempt + 1 : 1;
}

/**
 * Reads each verify.json and decides. Supported: the draft stays awaiting review. A fact without a
 * source: needs_manual with the sentences as the reason. No usable verify.json: one retry, then
 * needs_manual.
 */
export async function processVerify(deps: VerifyStageDeps): Promise<VerifyStageReport> {
  const { store, layout } = deps;
  const report: VerifyStageReport = { runId: layout.runId, results: [] };

  for (const item of await pendingItems(deps)) {
    const { company, draft } = item;
    const answer = await readJsonFile(layout.companyFile(company.slug, 'verify'));
    const evaluation =
      answer.status === 'ok'
        ? evaluateVerification(await buildVerifyInput(deps, item), answer.value)
        : { status: 'invalid' as const, errors: [answer.status === 'missing' ? 'verify.json was not written' : `verify.json ${answer.error}`] };

    if (evaluation.status === 'invalid') {
      const attempt = await attemptNumber(layout, company.slug, draft.id);
      await writeJsonAtomic(layout.companyFile(company.slug, 'verify-errors'), { draftId: draft.id, attempt, errors: evaluation.errors });
      if (attempt < MAX_ATTEMPTS) {
        report.results.push({ slug: company.slug, outcome: answer.status === 'missing' ? 'missing' : 'retry', detail: evaluation.errors.slice(0, 3).join('; ') });
        continue;
      }
      const reason = 'blind verifier produced no usable output twice';
      await markNeedsManual(deps, item, reason, { errors: evaluation.errors });
      report.results.push({ slug: company.slug, outcome: 'needs_manual', detail: reason });
      continue;
    }

    if (evaluation.issues.length === 0) {
      await writeJsonAtomic(layout.companyFile(company.slug, 'verify-report'), { draftId: draft.id, outcome: 'verified', issues: [] });
      await store.recordEvent(company.id, 'draft.verified', { draftId: draft.id });
      report.results.push({ slug: company.slug, outcome: 'verified' });
      continue;
    }

    const reason = reasonFor(evaluation.issues);
    await markNeedsManual(deps, item, reason, { issues: evaluation.issues });
    report.results.push({ slug: company.slug, outcome: 'needs_manual', detail: reason });
  }
  return report;
}

async function markNeedsManual(
  { store, layout }: VerifyStageDeps,
  { company, draft }: PendingItem,
  reason: string,
  detail: { issues?: VerificationIssue[]; errors?: string[] },
): Promise<void> {
  await writeJsonAtomic(layout.companyFile(company.slug, 'verify-report'), {
    draftId: draft.id,
    outcome: 'needs_manual',
    reason,
    issues: detail.issues ?? [],
  });
  await store.updateCompany(company.id, { status: 'needs_manual', statusReason: reason });
  await store.recordEvent(company.id, 'draft.verification_failed', { draftId: draft.id, reason, ...detail });
}

import { z } from 'zod';

import { verifyClaims } from '../core/quote-verifier';
import type { OutreachStore } from '../db/outreach-store';
import { OutreachDossierSchema } from '../schemas/outreach';

import { RunLayout, readJsonFile, writeJsonAtomic } from './run-layout';
import { createManifestSnapshotLoader } from './snapshot.service';

/** Companies scoring below this are dropped (SPEC diagram: fit < 3 → dropped). */
export const MIN_FIT_SCORE = 3;

// The researcher may decline to produce a dossier and say why: the company
// looks defunct, the email belongs to someone else, a page tried to give it
// instructions. Those go to the human instead of being guessed at.
const NeedsManualSchema = z.object({ needs_manual: z.string().trim().min(1).max(300) });

export type DossierOutcome =
  | 'dossier_ready'
  | 'dropped'
  | 'needs_manual'
  | 'missing'
  | 'invalid';

export interface DossierStageReport {
  runId: string;
  results: Array<{ slug: string; outcome: DossierOutcome; detail?: string }>;
}

export interface StageDeps {
  store: OutreachStore;
  layout: RunLayout;
}

/**
 * Verifies and stores every dossier the researcher wrote for companies still
 * `ingested`. A company with no dossier file, or an invalid one, is left
 * `ingested` (and an errors file is written for the retry), so running the
 * stage again after a crash or a fix only touches what is left.
 */
export async function processDossiers({ store, layout }: StageDeps): Promise<DossierStageReport> {
  const companies = await store.listCompanies({ runId: layout.runId, statuses: ['ingested'] });
  const report: DossierStageReport = { runId: layout.runId, results: [] };

  for (const company of companies) {
    const record = (outcome: DossierOutcome, detail?: string): void => {
      report.results.push({ slug: company.slug, outcome, ...(detail === undefined ? {} : { detail }) });
    };
    const read = await readJsonFile(layout.companyFile(company.slug, 'dossier'));
    if (read.status === 'missing') {
      record('missing');
      continue;
    }
    if (read.status === 'invalid') {
      await writeJsonAtomic(layout.companyFile(company.slug, 'dossier-errors'), { errors: [read.error] });
      record('invalid', read.error);
      continue;
    }

    const manual = NeedsManualSchema.safeParse(read.value);
    if (manual.success) {
      await store.updateCompany(company.id, { status: 'needs_manual', statusReason: manual.data.needs_manual });
      await store.recordEvent(company.id, 'dossier.needs_manual', { reason: manual.data.needs_manual });
      record('needs_manual', manual.data.needs_manual);
      continue;
    }

    const parsed = OutreachDossierSchema.safeParse(read.value);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'dossier'}: ${issue.message}`);
      await writeJsonAtomic(layout.companyFile(company.slug, 'dossier-errors'), { errors });
      record('invalid', errors.slice(0, 3).join('; '));
      continue;
    }

    const dossier = parsed.data;
    const { verified, rejected } = await verifyClaims(
      dossier.claims,
      createManifestSnapshotLoader(layout.snapshotsDir(company.slug)),
    );
    const stored = { ...dossier, claims: verified };
    const lowFit = dossier.fit.score < MIN_FIT_SCORE;

    const status = lowFit ? 'dropped' : 'dossier_ready';
    const statusReason = lowFit
      ? `fit ${dossier.fit.score} < ${MIN_FIT_SCORE}`
      : verified.length === 0
        ? 'no verified claims: generic email'
        : null;

    // Written before the DB step so a crash in between is repaired by the next run (the company is still `ingested`).
    // The writer agent reads this file and never the raw dossier.json, so it only ever sees verified claims.
    if (!lowFit) await writeJsonAtomic(layout.companyFile(company.slug, 'dossier.verified'), stored);

    await store.storeDossier(
      company.id,
      {
        data: stored,
        rejectedClaims: rejected.map(({ claim, reason }) => ({ claim, reason })),
        verifiedClaimCount: verified.length,
      },
      { status, statusReason, track: dossier.fit.track },
    );
    record(status, statusReason ?? `${verified.length} verified claims, ${rejected.length} rejected`);
  }
  return report;
}

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { guardTailoring } from '../core/bullet-guard';
import type { BulletViolation } from '../core/bullet-guard';
import { critiqueDraft } from '../core/critic';
import type { CriticFailure } from '../core/critic';
import type { CompanyRecord, DossierRecord } from '../db/outreach-store';
import { OutreachDraftSchema, OutreachTailoringSchema } from '../schemas/outreach';
import type { OutreachDraft, OutreachTailoring } from '../schemas/outreach';

import { createGenericDraft } from './generic-draft.service';
import type { GenericDraftDeps } from './generic-draft.service';
import { readJsonFile, relativeToRoot, trackResumePath, writeJsonAtomic } from './run-layout';
import { ResumeRenderError, renderTailoring, writeResumeFiles } from './resume.service';
import type { ResumeRenderer } from './resume.service';

export type DraftOutcome =
  | 'awaiting_review'
  | 'generic_draft'
  | 'retry'
  | 'missing'
  | 'failed';

export interface DraftStageReport {
  runId: string;
  results: Array<{ slug: string; outcome: DraftOutcome; detail?: string }>;
}

export interface DraftStageDeps extends GenericDraftDeps {
  renderer: ResumeRenderer;
}

interface Rejection {
  schema_errors: string[];
  bullet_violations: BulletViolation[];
  critic_failures: CriticFailure[];
}

function zodLines(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`);
}

/**
 * Turns the writer's tailoring.json + draft.json into a draft awaiting
 * review. Rejections write critic.json (the writer's feedback) and count as
 * an attempt; once the retry limit is spent the company gets a generic
 * draft instead, so it always ends with something sendable.
 */
export async function processDrafts(deps: DraftStageDeps): Promise<DraftStageReport> {
  const { store, layout, config } = deps;
  const companies = await store.listCompanies({ runId: layout.runId, statuses: ['dossier_ready'] });
  const report: DraftStageReport = { runId: layout.runId, results: [] };

  for (const company of companies) {
    const push = (outcome: DraftOutcome, detail?: string): void => {
      report.results.push({ slug: company.slug, outcome, ...(detail === undefined ? {} : { detail }) });
    };
    const dossier = await store.getLatestDossier(company.id);
    if (!dossier) {
      await store.updateCompany(company.id, { status: 'failed', statusReason: 'dossier_ready without a dossier' });
      push('failed', 'no dossier stored');
      continue;
    }

    if (dossier.verifiedClaimCount === 0) {
      const generic = await createGenericDraft(deps, company, 'no verified claims');
      push(generic.outcome, generic.outcome === 'failed' ? generic.detail : undefined);
      continue;
    }

    const [tailoringRead, draftRead] = await Promise.all([
      readJsonFile(layout.companyFile(company.slug, 'tailoring')),
      readJsonFile(layout.companyFile(company.slug, 'draft')),
    ]);
    if (tailoringRead.status === 'missing' || draftRead.status === 'missing') {
      // A writer that produces nothing is an attempt too, otherwise the retry loop would never end.
      const attempts = company.draftAttempts + 1;
      await store.updateCompany(company.id, { draftAttempts: attempts });
      await store.recordEvent(company.id, 'draft.missing', { attempt: attempts });
      if (attempts > config.draftRetryLimit) {
        const generic = await createGenericDraft(deps, company, `writer produced no files ${attempts} times`);
        push(generic.outcome, generic.outcome === 'failed' ? generic.detail : undefined);
      } else {
        push('missing');
      }
      continue;
    }

    const rejection = await evaluate(deps, company, dossier.data, tailoringRead, draftRead);
    if ('rejection' in rejection) {
      const attempts = company.draftAttempts + 1;
      await writeJsonAtomic(layout.companyFile(company.slug, 'critic'), { attempt: attempts, ...rejection.rejection });
      await store.updateCompany(company.id, { draftAttempts: attempts });
      await store.recordEvent(company.id, 'draft.rejected', { attempt: attempts });
      if (attempts > config.draftRetryLimit) {
        const generic = await createGenericDraft(deps, company, `writer failed ${attempts} times`);
        push(generic.outcome, generic.outcome === 'failed' ? generic.detail : undefined);
      } else {
        push('retry', summarize(rejection.rejection));
      }
      continue;
    }

    const { tailoring, draft } = rejection;
    const pdf = await resumeFor(deps, company, dossier.data.fit.track, tailoring);
    await store.storeDraft(company.id, {
      generic: false,
      language: dossier.data.language,
      subject: draft.subject,
      body: draft.body,
      followUpBody: draft.follow_up_body,
      cta: draft.cta,
      hookClaimId: draft.hook_claim_id,
      anchorPhrase: draft.anchor_phrase,
      followUpClaimId: draft.follow_up_claim_id ?? null,
      mentionedProjects: draft.mentioned_projects,
      tailoring,
      resumeKind: pdf.kind,
      track: dossier.data.fit.track,
      resumePdfPath: pdf.path,
    });
    push('awaiting_review', pdf.kind === 'track' ? `track resume used: ${pdf.reason}` : undefined);
  }
  return report;
}

function summarize(rejection: Rejection): string {
  return [
    ...rejection.schema_errors,
    ...rejection.bullet_violations.map((violation) => `${violation.rule}: ${violation.where}`),
    ...rejection.critic_failures.map((failure) => failure.rule),
  ]
    .slice(0, 6)
    .join('; ');
}

async function evaluate(
  deps: DraftStageDeps,
  company: CompanyRecord,
  dossier: DossierRecord['data'],
  tailoringRead: Awaited<ReturnType<typeof readJsonFile>>,
  draftRead: Awaited<ReturnType<typeof readJsonFile>>,
): Promise<{ rejection: Rejection } | { tailoring: OutreachTailoring; draft: OutreachDraft }> {
  const schemaErrors: string[] = [];
  let tailoring: OutreachTailoring | null = null;
  let draft: OutreachDraft | null = null;

  if (tailoringRead.status === 'invalid') schemaErrors.push(`tailoring.json: ${tailoringRead.error}`);
  else if (tailoringRead.status === 'ok') {
    const parsed = OutreachTailoringSchema.safeParse(tailoringRead.value);
    if (parsed.success) tailoring = parsed.data;
    else schemaErrors.push(...zodLines(parsed.error).map((line) => `tailoring.json ${line}`));
  }
  if (draftRead.status === 'invalid') schemaErrors.push(`draft.json: ${draftRead.error}`);
  else if (draftRead.status === 'ok') {
    const parsed = OutreachDraftSchema.safeParse(draftRead.value);
    if (parsed.success) draft = parsed.data;
    else schemaErrors.push(...zodLines(parsed.error).map((line) => `draft.json ${line}`));
  }

  // A hook-less draft is the generic path; the writer is never allowed to claim it for a researched company.
  if (draft?.generic) schemaErrors.push('draft.json generic: must be false for a researched company');

  const bulletViolations = tailoring
    ? guardTailoring(tailoring, deps.db, { foreignTerms: dossier.tech_stack }).violations
    : [];
  const criticFailures = draft
    ? critiqueDraft({
        draft,
        language: dossier.language,
        companyName: company.name,
        timezone: dossier.timezone,
        config: deps.config.outreach,
        verifiedClaims: dossier.claims,
        masterDb: deps.db,
      }).failures
    : [];

  if (schemaErrors.length > 0 || bulletViolations.length > 0 || criticFailures.length > 0 || !tailoring || !draft) {
    return { rejection: { schema_errors: schemaErrors, bullet_violations: bulletViolations, critic_failures: criticFailures } };
  }
  return { tailoring, draft };
}

// Prefer the tailored resume; if it will not render to one small page, the track resume of the company's best-fit track.
async function resumeFor(
  deps: DraftStageDeps,
  company: CompanyRecord,
  track: 'ai' | 'swe' | 'fullstack',
  tailoring: OutreachTailoring,
): Promise<{ kind: 'tailored' | 'track'; path: string; reason: string }> {
  const { layout, renderer, db, store } = deps;
  try {
    const result = await renderTailoring(tailoring, db, renderer);
    const hash = createHash('sha1').update(result.pdf).digest('hex').slice(0, 8);
    const pdfPath = join(layout.storageDir(company.slug), `resume-${hash}.pdf`);
    await writeResumeFiles(pdfPath, result);
    return { kind: 'tailored', path: relativeToRoot(layout.paths, pdfPath), reason: '' };
  } catch (error) {
    if (!(error instanceof ResumeRenderError)) throw error;
    await store.recordEvent(company.id, 'resume.fell_back_to_track', { track, reason: error.message });
    return {
      kind: 'track',
      path: relativeToRoot(layout.paths, trackResumePath(layout.paths, track)),
      reason: error.message,
    };
  }
}

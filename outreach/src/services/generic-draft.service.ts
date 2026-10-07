import { access } from 'node:fs/promises';

import { buildGenericEmail, countryFromDomain, languageFromDomain } from '../core/generic-email';
import { critiqueDraft } from '../core/critic';
import type { CriticFailure } from '../core/critic';
import { fallbackTimezone, overlapRegion } from '../core/locale';
import { normalizeForMatch } from '../core/text-utils';
import { rankProjects } from '../core/track-selection';
import type { AppConfig } from '../config/app-config';
import type { CompanyRecord, OutreachStore } from '../db/outreach-store';
import type { MasterDB } from '../resume/master-db';
import type { OutreachDraft, OutreachTrack } from '../schemas/outreach';

import { RunLayout, relativeToRoot, trackResumePath, writeJsonAtomic } from './run-layout';
import { loadManifestSnapshotTexts } from './snapshot.service';

export interface GenericDraftDeps {
  store: OutreachStore;
  layout: RunLayout;
  config: AppConfig;
  db: MasterDB;
}

export type GenericOutcome = { slug: string; outcome: 'generic_draft' } | { slug: string; outcome: 'failed'; detail: string };

/** The fallback needs the three prebuilt resumes; refuse to start without them rather than fail company by company. */
export async function assertTrackResumesExist(layout: RunLayout): Promise<void> {
  for (const track of ['ai', 'swe', 'fullstack'] as const) {
    try {
      await access(trackResumePath(layout.paths, track));
    } catch {
      throw new Error(`Track resume "${track}" is missing. Run "npm run outreach -- track-resumes" first.`);
    }
  }
}

function pickProject(db: MasterDB, config: AppConfig, track: OutreachTrack): MasterDB['projects'][number] | null {
  const rules = config.tracks[track];
  const named = rules.proof_project
    ? db.projects.find((project) => project.name.toLowerCase() === rules.proof_project?.toLowerCase())
    : undefined;
  return named ?? rankProjects(db, rules.keywords)[0] ?? null;
}

/**
 * Stores a generic draft (template email + the company's best-fit track
 * resume) for one company. Runs the same critic as a written email; if the
 * template cannot pass it (for example the config's availability lines push
 * the body out of the word band) the company is marked `failed` with the
 * rules that broke, instead of queueing a bad email.
 */
export async function createGenericDraft(
  deps: GenericDraftDeps,
  company: CompanyRecord,
  reason: string,
): Promise<GenericOutcome> {
  const { store, layout, config, db } = deps;
  const [contact, dossier] = await Promise.all([store.getContact(company.id), store.getLatestDossier(company.id)]);

  const track: OutreachTrack = dossier?.data.fit.track ?? company.track ?? 'swe';
  const language = dossier?.data.language ?? languageFromDomain(company.domain);
  const timezone =
    dossier?.data.timezone ??
    (countryFromDomain(company.domain) ? fallbackTimezone(countryFromDomain(company.domain) as string) : null) ??
    config.fallbackTimezone;
  const project = pickProject(db, config, track);
  if (!project) {
    await store.updateCompany(company.id, { status: 'failed', statusReason: 'generic email needs at least one project' });
    return { slug: company.slug, outcome: 'failed', detail: 'the data inventory has no project to mention' };
  }

  // The researcher's one-liner and contact name are not quote-verified claims. They go into an email only
  // when the text really occurs in a saved snapshot; the name from the user's own list is trusted.
  const snapshotTexts = (await loadManifestSnapshotTexts(layout.snapshotsDir(company.slug))).map(normalizeForMatch);
  const occursInSnapshot = (value: string | undefined): value is string =>
    value !== undefined && normalizeForMatch(value) !== '' && snapshotTexts.some((text) => text.includes(normalizeForMatch(value)));
  const oneLiner = occursInSnapshot(dossier?.data.one_liner) ? dossier?.data.one_liner : undefined;
  const contactName = occursInSnapshot(dossier?.data.contact_name) ? dossier?.data.contact_name : (contact?.name ?? undefined);

  const attempt = (oneLiner: string | undefined): { draft: OutreachDraft; failures: CriticFailure[] } => {
    const email = buildGenericEmail({
      language,
      companyName: company.name,
      oneLiner,
      contactName,
      availability: config.outreach.availability[language],
      region: overlapRegion(timezone),
      track,
      project: { name: project.name, technologies: project.technologies_used },
    });
    const draft: OutreachDraft = {
      ...email,
      hook_claim_id: null,
      anchor_phrase: null,
      mentioned_projects: [project.name],
      generic: true,
    };
    const result = critiqueDraft({
      draft,
      language,
      companyName: company.name,
      timezone,
      config: config.outreach,
      verifiedClaims: [],
      masterDb: db,
    });
    return { draft, failures: result.failures };
  };

  let outcome = attempt(oneLiner);
  // A scraped one-liner can carry a number or phrase the critic rejects; the email is still sendable without it.
  if (outcome.failures.length > 0 && oneLiner !== undefined) outcome = attempt(undefined);

  if (outcome.failures.length > 0) {
    await writeJsonAtomic(layout.companyFile(company.slug, 'critic'), { generic: true, critic_failures: outcome.failures });
    await store.updateCompany(company.id, { status: 'failed', statusReason: 'generic email failed the critic' });
    await store.recordEvent(company.id, 'generic.failed', { failures: outcome.failures });
    return {
      slug: company.slug,
      outcome: 'failed',
      detail: outcome.failures.map((failure) => `${failure.rule}: ${failure.detail}`).join('; '),
    };
  }

  const { draft } = outcome;
  await store.storeDraft(company.id, {
    generic: true,
    language,
    subject: draft.subject,
    body: draft.body,
    followUpBody: draft.follow_up_body,
    cta: draft.cta,
    hookClaimId: null,
    anchorPhrase: null,
    mentionedProjects: draft.mentioned_projects,
    tailoring: null,
    resumeKind: 'track',
    track,
    resumePdfPath: relativeToRoot(layout.paths, trackResumePath(layout.paths, track)),
  });
  await store.recordEvent(company.id, 'generic.created', { reason, track });
  return { slug: company.slug, outcome: 'generic_draft' };
}

/** Generic drafts for every company of the run that has no draft yet and is not dropped or waiting on a human. */
export async function processGeneric(deps: GenericDraftDeps): Promise<{ runId: string; results: GenericOutcome[] }> {
  const companies = await deps.store.listCompanies({
    runId: deps.layout.runId,
    statuses: ['ingested', 'dossier_ready', 'failed'],
  });
  const results: GenericOutcome[] = [];
  for (const company of companies) {
    results.push(await createGenericDraft(deps, company, 'generic requested'));
  }
  return { runId: deps.layout.runId, results };
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InMemoryOutreachStore } from '../testing/in-memory-store';
import {
  FakeRenderer,
  WRITER_DRAFT,
  createTempPaths,
  dossierFor,
  layoutFor,
  loadExampleConfig,
  loadExampleInventory,
  rawRow,
  seedSnapshot,
  slugFor,
  writeCompanyFile,
  writerTailoring,
} from '../testing/test-env';

import { processDossiers } from './dossier-stage.service';
import { processDrafts } from './draft-stage.service';
import type { DraftStageDeps } from './draft-stage.service';
import { ingestRows } from './ingest.service';

const slug = slugFor('acme.fr');
const config = loadExampleConfig();
const db = loadExampleInventory();

async function setup(renderer = new FakeRenderer(), dossierOverrides: Record<string, unknown> = {}) {
  const store = new InMemoryOutreachStore();
  const layout = layoutFor(createTempPaths());
  await ingestRows({ store, layout, checkMx: async () => ({ syntaxValid: true, roleAccount: false, mx: 'ok' }) }, [
    rawRow('acme.fr', { company: 'Acme Robotics', name: 'Claire Martin' }),
  ]);
  await writeCompanyFile(layout, slug, 'dossier', dossierFor(await seedSnapshot(layout, slug), dossierOverrides));
  await processDossiers({ store, layout });
  const deps: DraftStageDeps = { store, layout, config, db, renderer };
  return { store, layout, deps, renderer };
}

async function writeWriterFiles(layout: ReturnType<typeof layoutFor>, draft: Record<string, unknown> = WRITER_DRAFT): Promise<void> {
  await writeCompanyFile(layout, slug, 'tailoring', writerTailoring());
  await writeCompanyFile(layout, slug, 'draft', draft);
}

describe('processDrafts', () => {
  it('stores a passing draft as awaiting_review with a tailored PDF under storage/', async () => {
    const { store, layout, deps } = await setup();
    await writeWriterFiles(layout);

    const report = await processDrafts(deps);

    expect(report.results).toEqual([{ slug, outcome: 'awaiting_review' }]);
    const [company] = await store.listCompanies();
    expect(company.status).toBe('awaiting_review');
    const draft = await store.getLatestDraft(company.id);
    expect(draft).toMatchObject({ generic: false, resumeKind: 'tailored', hookClaimId: 'c1', language: 'en', track: 'ai' });
    expect(draft?.resumePdfPath).toMatch(/^storage\/run-1\/.+\/resume-[0-9a-f]{8}\.pdf$/);
    expect(existsSync(join(layout.paths.root, draft?.resumePdfPath ?? ''))).toBe(true);
  });

  it('reports missing writer files, leaves the company waiting and counts it as an attempt', async () => {
    const { store, deps } = await setup();
    const report = await processDrafts(deps);
    expect(report.results).toEqual([{ slug, outcome: 'missing' }]);
    expect((await store.listCompanies())[0]).toMatchObject({ status: 'dossier_ready', draftAttempts: 1 });
  });

  it('ends a writer that never produces files in the generic fallback once the retry limit is spent', async () => {
    const { store, deps } = await setup();
    const outcomes: string[] = [];
    for (let run = 0; run <= config.draftRetryLimit; run += 1) {
      outcomes.push((await processDrafts(deps)).results[0].outcome);
    }
    expect(outcomes).toEqual(['missing', 'missing', 'generic_draft']);
    expect((await store.getLatestDraft((await store.listCompanies())[0].id))?.generic).toBe(true);
  });

  it('stores the follow-up claim id when it is a verified claim', async () => {
    const { store, layout, deps } = await setup();
    await writeWriterFiles(layout, { ...WRITER_DRAFT, follow_up_claim_id: 'c1' });
    await processDrafts(deps);
    expect((await store.getLatestDraft((await store.listCompanies())[0].id))?.followUpClaimId).toBe('c1');
  });

  it('rejects a follow-up that cites a claim the dossier does not have verified', async () => {
    const { layout, deps } = await setup();
    await writeWriterFiles(layout, { ...WRITER_DRAFT, follow_up_claim_id: 'c9' });
    const report = await processDrafts(deps);
    expect(report.results[0].outcome).toBe('retry');
    const critic = JSON.parse(readFileSync(layout.companyFile(slug, 'critic'), 'utf-8'));
    expect(critic.critic_failures.map((failure: { rule: string }) => failure.rule)).toContain('follow_up_claim');
  });

  it('writes critic.json, counts the attempt and keeps the company for a retry when the critic fails', async () => {
    const { store, layout, deps } = await setup();
    await writeWriterFiles(layout, { ...WRITER_DRAFT, body: `${WRITER_DRAFT.body} It is truly **great**.` });

    const report = await processDrafts(deps);

    expect(report.results[0].outcome).toBe('retry');
    const critic = JSON.parse(readFileSync(layout.companyFile(slug, 'critic'), 'utf-8'));
    expect(critic.attempt).toBe(1);
    expect(critic.critic_failures.map((failure: { rule: string }) => failure.rule)).toContain('markdown');
    const [company] = await store.listCompanies();
    expect(company).toMatchObject({ status: 'dossier_ready', draftAttempts: 1 });
    expect(store.drafts).toHaveLength(0);
  });

  it('rejects a bullet that invents a number and reports the violation', async () => {
    const { layout, deps } = await setup();
    const tailoring = writerTailoring() as { entries: Array<{ bullets: Array<{ text: string }> }> };
    tailoring.entries[0].bullets[0].text = 'Built a retrieval pipeline that answers support questions over 90,000 internal documents';
    await writeCompanyFile(layout, slug, 'tailoring', tailoring);
    await writeCompanyFile(layout, slug, 'draft', WRITER_DRAFT);

    await processDrafts(deps);

    const critic = JSON.parse(readFileSync(layout.companyFile(slug, 'critic'), 'utf-8'));
    expect(critic.bullet_violations.map((violation: { rule: string }) => violation.rule)).toContain('invented_number');
  });

  it('flags a bullet naming the company stack the profile lacks (foreign technology)', async () => {
    const { layout, deps } = await setup();
    const tailoring = writerTailoring() as { entries: Array<{ bullets: Array<{ text: string }> }> };
    tailoring.entries[0].bullets[2].text = 'Added an evaluation harness of 150 test questions written in Rust for every pull request';
    await writeCompanyFile(layout, slug, 'tailoring', tailoring);
    await writeCompanyFile(layout, slug, 'draft', WRITER_DRAFT);

    await processDrafts(deps);

    const critic = JSON.parse(readFileSync(layout.companyFile(slug, 'critic'), 'utf-8'));
    expect(critic.bullet_violations.length).toBeGreaterThan(0);
  });

  it('reports schema errors for malformed writer output as a retryable rejection', async () => {
    const { layout, deps } = await setup();
    await writeCompanyFile(layout, slug, 'tailoring', { summary: 'too short' });
    await writeCompanyFile(layout, slug, 'draft', WRITER_DRAFT);

    const report = await processDrafts(deps);

    expect(report.results[0].outcome).toBe('retry');
    const critic = JSON.parse(readFileSync(layout.companyFile(slug, 'critic'), 'utf-8'));
    expect(critic.schema_errors.join(' ')).toContain('tailoring.json');
  });

  it('refuses a draft that marks itself generic for a researched company', async () => {
    const { layout, deps } = await setup();
    await writeWriterFiles(layout, { ...WRITER_DRAFT, generic: true });
    await processDrafts(deps);
    const critic = JSON.parse(readFileSync(layout.companyFile(slug, 'critic'), 'utf-8'));
    expect(critic.schema_errors.join(' ')).toContain('generic');
  });

  it('falls back to a generic draft with the track resume after the retry limit is spent', async () => {
    const { store, layout, deps } = await setup();
    const bad = { ...WRITER_DRAFT, subject: 'GREAT NEWS!' };
    await writeWriterFiles(layout, bad);

    const outcomes: string[] = [];
    for (let run = 0; run <= config.draftRetryLimit; run += 1) {
      outcomes.push((await processDrafts(deps)).results[0].outcome);
    }

    expect(outcomes).toEqual(['retry', 'retry', 'generic_draft']);
    const [company] = await store.listCompanies();
    expect(company.status).toBe('awaiting_review');
    const draft = await store.getLatestDraft(company.id);
    expect(draft).toMatchObject({ generic: true, resumeKind: 'track', resumePdfPath: 'storage/tracks/ai.pdf' });
  });

  it('uses the track resume when the tailored one is not a single page', async () => {
    const { store, layout, deps } = await setup(new FakeRenderer({ pageCount: 2 }));
    await writeWriterFiles(layout);

    const report = await processDrafts(deps);

    expect(report.results[0]).toMatchObject({ outcome: 'awaiting_review' });
    expect(report.results[0].detail).toContain('2 pages');
    const draft = await store.getLatestDraft((await store.listCompanies())[0].id);
    expect(draft).toMatchObject({ generic: false, resumeKind: 'track', resumePdfPath: 'storage/tracks/ai.pdf' });
    expect(store.events.map((event) => event.type)).toContain('resume.fell_back_to_track');
  });

  it('uses the track resume when the PDF is 80 KB or more or the render throws', async () => {
    for (const renderer of [new FakeRenderer({ bytes: 80 * 1024 }), new FakeRenderer({ fail: 'tectonic missing' })]) {
      const { store, layout, deps } = await setup(renderer);
      await writeWriterFiles(layout);
      await processDrafts(deps);
      expect((await store.getLatestDraft((await store.listCompanies())[0].id))?.resumeKind).toBe('track');
    }
  });

  it('goes straight to a generic draft when no claim was verified', async () => {
    const { store, deps, renderer } = await setup(new FakeRenderer(), { claims: [] });

    const report = await processDrafts(deps);

    expect(report.results).toEqual([{ slug, outcome: 'generic_draft' }]);
    expect(renderer.calls).toBe(0);
    expect((await store.getLatestDraft((await store.listCompanies())[0].id))?.generic).toBe(true);
  });

  it('does not touch companies that already have a draft, so resuming is safe', async () => {
    const { store, layout, deps } = await setup();
    await writeWriterFiles(layout);
    await processDrafts(deps);

    const second = await processDrafts(deps);

    expect(second.results).toEqual([]);
    expect(store.drafts).toHaveLength(1);
  });

  it('supersedes the earlier draft when a new version is stored', async () => {
    const { store, layout, deps } = await setup();
    await writeWriterFiles(layout);
    await processDrafts(deps);
    const [company] = await store.listCompanies();
    await store.updateCompany(company.id, { status: 'dossier_ready' });

    await processDrafts(deps);

    expect(store.drafts.map((draft) => draft.status)).toEqual(['superseded', 'awaiting_review']);
  });
});

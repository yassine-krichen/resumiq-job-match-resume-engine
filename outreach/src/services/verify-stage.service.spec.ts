import { existsSync, readFileSync } from 'node:fs';

import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { seedDraft } from '../testing/seed';
import { createTempPaths, layoutFor, loadExampleConfig, loadExampleInventory } from '../testing/test-env';
import type { VerifyInput } from '../core/draft-verification';
import type { NewDraft } from '../db/outreach-store';

import { writeJsonAtomic } from './run-layout';
import type { RunLayout } from './run-layout';
import { snapshotUrl } from './snapshot.service';
import { isDraftVerified, pendingVerifySlugs, prepareVerify, processVerify } from './verify-stage.service';

const config = loadExampleConfig();
const db = loadExampleInventory();

async function setup(options: { generic?: boolean } = {}) {
  const store = new InMemoryOutreachStore();
  const layout = layoutFor(createTempPaths());
  const { company, draft } = await seedDraft(store, 'acme.fr', options);
  const deps = { store, layout, config, db };
  return { store, layout, deps, company, draft };
}

function readInput(layout: RunLayout, slug: string): VerifyInput {
  return JSON.parse(readFileSync(layout.companyFile(slug, 'verify-input'), 'utf-8')) as VerifyInput;
}

async function answerAll(layout: RunLayout, slug: string, verdict: (i: number) => Record<string, unknown>): Promise<void> {
  const input = readInput(layout, slug);
  await writeJsonAtomic(layout.companyFile(slug, 'verify'), { sentences: input.sentences.map((sentence) => verdict(sentence.i)) });
}

/** What the owner's edit in review does: a new draft version with some fields changed. */
async function storeEditedDraft(store: InMemoryOutreachStore, companyId: string, patch: Partial<NewDraft>): Promise<void> {
  const latest = await store.getLatestDraft(companyId);
  if (!latest) throw new Error('no draft to edit');
  const { generic, language, subject, body, followUpBody, cta, hookClaimId, anchorPhrase, mentionedProjects, tailoring, resumeKind, track, resumePdfPath } = latest;
  await store.storeDraft(companyId, {
    generic, language, subject, body, followUpBody, cta, hookClaimId, anchorPhrase, mentionedProjects, tailoring, resumeKind, track, resumePdfPath, ...patch,
  });
}

async function saveSnapshot(layout: RunLayout, slug: string, text: string): Promise<void> {
  const fetchFn = async (): Promise<Response> => new Response(`<html><body><p>${text}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  await snapshotUrl('https://acme.example/about', layout.snapshotsDir(slug), {
    fetchFn: fetchFn as unknown as typeof fetch,
    resolveHost: async () => ['93.184.216.34'],
  });
}

describe('prepareVerify', () => {
  it('writes the sentences, the verified claims and the candidate facts, and nothing from the dossier notes', async () => {
    const { layout, deps, company } = await setup();

    const report = await prepareVerify(deps);

    expect(report.slugs).toEqual([company.slug]);
    const input = readInput(layout, company.slug);
    expect(input.company).toBe('Acme Robotics');
    expect(input.sentences.length).toBeGreaterThan(4);
    expect(input.sentences.some((sentence) => sentence.part === 'follow_up')).toBe(true);
    expect(input.verified_claims.map((claim) => claim.id)).toEqual(['c1']);
    expect(input.candidate_facts.join('\n')).toContain('DocuAsk');
    expect(input.config_lines).toContain(config.outreach.availability.en.hours_line);
    const raw = readFileSync(layout.companyFile(company.slug, 'verify-input'), 'utf-8');
    expect(raw).not.toContain('warehouse robots'); // the dossier one-liner
    expect(raw).not.toContain('Python and infrastructure overlap'); // the fit reasons
    expect(raw).not.toContain('Rust'); // the company tech stack
  });

  it('gives a generic draft no claims', async () => {
    const { layout, deps, company } = await setup({ generic: true });
    await prepareVerify(deps);
    expect(readInput(layout, company.slug).verified_claims).toEqual([]);
  });

  it('removes a stale verify.json so an old answer is never read for a new input', async () => {
    const { layout, deps, company } = await setup();
    await writeJsonAtomic(layout.companyFile(company.slug, 'verify'), { sentences: [] });
    await prepareVerify(deps);
    expect(existsSync(layout.companyFile(company.slug, 'verify'))).toBe(false);
  });

  it('skips companies that are not awaiting review and drafts that are already verified', async () => {
    const { store, layout, deps, company, draft } = await setup();
    await prepareVerify(deps);
    await answerAll(layout, company.slug, (i) => ({ i, supported: true, by: 'candidate' }));
    await processVerify(deps);

    expect(await pendingVerifySlugs(store, layout)).toEqual([]);
    expect((await prepareVerify(deps)).slugs).toEqual([]);
    expect(draft.status).toBe('awaiting_review');
  });
});

describe('isDraftVerified', () => {
  it('is true only for the draft version the verifier passed', async () => {
    const { store, layout, deps, company, draft } = await setup();
    expect(await isDraftVerified(layout, company.slug, draft.id)).toBe(false);

    await prepareVerify(deps);
    await answerAll(layout, company.slug, (i) => ({ i, supported: true, by: 'candidate' }));
    await processVerify(deps);
    expect(await isDraftVerified(layout, company.slug, draft.id)).toBe(true);

    await storeEditedDraft(store, company.id, { subject: 'A different subject' });
    const edited = await store.getLatestDraft(company.id);
    expect(await isDraftVerified(layout, company.slug, edited?.id ?? '')).toBe(false);
  });

  it('is false when the verifier flagged the draft', async () => {
    const { layout, deps, company, draft } = await setup();
    await prepareVerify(deps);
    await answerAll(layout, company.slug, (i) => ({ i, supported: false, by: null }));
    await processVerify(deps);

    expect(await isDraftVerified(layout, company.slug, draft.id)).toBe(false);
  });
});

describe('processVerify', () => {
  it('keeps a draft awaiting review when every fact is supported', async () => {
    const { store, layout, deps, company } = await setup();
    await prepareVerify(deps);
    await answerAll(layout, company.slug, (i) => ({ i, supported: true, by: 'candidate' }));

    const report = await processVerify(deps);

    expect(report.results).toEqual([{ slug: company.slug, outcome: 'verified' }]);
    expect((await store.getCompany(company.id))?.status).toBe('awaiting_review');
    expect(store.events.some((event) => event.type === 'draft.verified')).toBe(true);
  });

  it('moves the company to needs_manual with the unsupported sentence as the reason', async () => {
    const { store, layout, deps, company } = await setup();
    await prepareVerify(deps);
    const input = readInput(layout, company.slug);
    await answerAll(layout, company.slug, (i) => (i === 0 ? { i, supported: false, by: null } : { i, supported: true, by: 'candidate' }));

    const report = await processVerify(deps);

    expect(report.results[0]).toMatchObject({ slug: company.slug, outcome: 'needs_manual' });
    const updated = await store.getCompany(company.id);
    expect(updated?.status).toBe('needs_manual');
    expect(updated?.statusReason).toContain(input.sentences[0].text.slice(0, 30));
    const saved = JSON.parse(readFileSync(layout.companyFile(company.slug, 'verify-report'), 'utf-8')) as { outcome: string; issues: unknown[] };
    expect(saved).toMatchObject({ outcome: 'needs_manual' });
    expect(saved.issues).toHaveLength(1);
  });

  it('treats a sentence with a number as a fact even when the verifier says it states none', async () => {
    const { layout, deps, company } = await setup();
    await prepareVerify(deps);
    await answerAll(layout, company.slug, (i) => ({ i, supported: false, by: null, fact: false }));

    const report = await processVerify(deps);

    const withNumbers = readInput(layout, company.slug).sentences.filter((sentence) => /\d/.test(sentence.text));
    expect(withNumbers.length).toBeGreaterThan(0);
    expect(report.results[0].outcome).toBe('needs_manual');
    const saved = JSON.parse(readFileSync(layout.companyFile(company.slug, 'verify-report'), 'utf-8')) as { issues: unknown[] };
    expect(saved.issues).toHaveLength(withNumbers.length);
  });

  it('verifies a generic draft too', async () => {
    const { layout, deps, company } = await setup({ generic: true });
    await prepareVerify(deps);
    await answerAll(layout, company.slug, (i) => ({ i, supported: true, by: 'candidate' }));
    expect((await processVerify(deps)).results[0].outcome).toBe('verified');
  });

  it('asks for one retry when verify.json is missing and gives up to needs_manual the second time', async () => {
    const { store, deps, company } = await setup();
    await prepareVerify(deps);

    const first = await processVerify(deps);
    expect(first.results).toEqual([{ slug: company.slug, outcome: 'missing', detail: 'verify.json was not written' }]);
    expect((await store.getCompany(company.id))?.status).toBe('awaiting_review');

    const second = await processVerify(deps);
    expect(second.results[0]).toMatchObject({ slug: company.slug, outcome: 'needs_manual' });
    const updated = await store.getCompany(company.id);
    expect(updated?.status).toBe('needs_manual');
    expect(updated?.statusReason).toMatch(/no usable output/i);
  });

  it('treats an invalid verify.json as a failed attempt and records what was wrong', async () => {
    const { store, layout, deps, company } = await setup();
    await prepareVerify(deps);
    await writeJsonAtomic(layout.companyFile(company.slug, 'verify'), { sentences: [{ i: 0, supported: true, by: 'candidate' }] });

    const first = await processVerify(deps);
    expect(first.results[0].outcome).toBe('retry');
    const errors = JSON.parse(readFileSync(layout.companyFile(company.slug, 'verify-errors'), 'utf-8')) as { attempt: number; errors: string[] };
    expect(errors.attempt).toBe(1);
    expect(errors.errors.join(' ')).toMatch(/no verdict/);

    await writeJsonAtomic(layout.companyFile(company.slug, 'verify'), { sentences: [] });
    const second = await processVerify(deps);
    expect(second.results[0].outcome).toBe('needs_manual');
    expect((await store.getCompany(company.id))?.status).toBe('needs_manual');
  });

  it('uses the sentences it computes itself, not a verify-input.json an agent could have edited', async () => {
    const { layout, deps, company } = await setup();
    await prepareVerify(deps);
    await writeJsonAtomic(layout.companyFile(company.slug, 'verify-input'), { sentences: [{ i: 0, part: 'body', text: 'Hello.' }] });
    await writeJsonAtomic(layout.companyFile(company.slug, 'verify'), { sentences: [{ i: 0, supported: true, by: 'candidate' }] });

    expect((await processVerify(deps)).results[0].outcome).toBe('retry');
  });

  it('counts a retry only against the same draft version', async () => {
    const { store, deps, company } = await setup();
    await prepareVerify(deps);
    expect((await processVerify(deps)).results[0].outcome).toBe('missing');

    await storeEditedDraft(store, company.id, { subject: 'A different subject' });
    await prepareVerify(deps);
    expect((await processVerify(deps)).results[0].outcome).toBe('missing');
  });

  it('lets a generic draft rest on the one-liner when the email uses it and a saved page contains it', async () => {
    const { store, layout, deps, company } = await setup({ generic: true });
    await saveSnapshot(layout, company.slug, 'Acme makes warehouse robots and fleet software for logistics teams.');
    await storeEditedDraft(store, company.id, { body: 'Hello, I came across Acme Robotics (warehouse robots) and wanted to introduce myself.' });

    await prepareVerify(deps);

    expect(readInput(layout, company.slug).verified_claims.map((claim) => claim.id)).toEqual(['one_liner']);
  });

  it('does not offer the one-liner when no saved page contains it', async () => {
    const { store, layout, deps, company } = await setup({ generic: true });
    await storeEditedDraft(store, company.id, { body: 'Hello, I came across Acme Robotics (warehouse robots) and wanted to introduce myself.' });

    await prepareVerify(deps);

    expect(readInput(layout, company.slug).verified_claims).toEqual([]);
  });
});

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { createTempPaths, dossierFor, layoutFor, loadExampleConfig, loadExampleInventory, rawRow as baseRow, seedSnapshot, slugFor, writeCompanyFile } from '../testing/test-env';

import { processDossiers } from './dossier-stage.service';
import { assertTrackResumesExist, processGeneric } from './generic-draft.service';
import { ingestRows } from './ingest.service';
import { pendingSlugs, statusText, summaryText } from './report.service';

const config = loadExampleConfig();
const db = loadExampleInventory();
// A name with a dot would look like a link to the critic, so give companies plain names.
function rawRow(domain: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const label = domain.split('.')[0];
  return baseRow(domain, { company: `${label[0].toUpperCase()}${label.slice(1)} Labs`, ...overrides });
}
const mxOk = async () => ({ syntaxValid: true, roleAccount: false, mx: 'ok' as const });

async function setup(rows: Array<Record<string, unknown>>) {
  const store = new InMemoryOutreachStore();
  const layout = layoutFor(createTempPaths());
  await ingestRows({ store, layout, checkMx: mxOk }, rows);
  return { store, layout, deps: { store, layout, config, db } };
}

describe('processGeneric', () => {
  it('creates a generic draft with the track resume for every unfinished company', async () => {
    const { store, deps } = await setup([rawRow('acme.fr', { company: 'Acme Robotics' }), rawRow('beta.com', { company: 'Beta Labs' })]);

    const { results } = await processGeneric(deps);

    expect(results.map((result) => result.outcome)).toEqual(['generic_draft', 'generic_draft']);
    const drafts = await store.listLatestDrafts('run-1');
    expect(drafts.every((draft) => draft.generic && draft.resumeKind === 'track')).toBe(true);
    expect((await store.listCompanies()).every((company) => company.status === 'awaiting_review')).toBe(true);
  });

  it('writes French for a .fr domain and English for .com when no research ran', async () => {
    const { store, deps } = await setup([rawRow('acme.fr', { company: 'Acme Robotics' }), rawRow('beta.com', { company: 'Beta Labs' })]);
    await processGeneric(deps);
    const byCompany = new Map((await store.listLatestDrafts()).map((draft) => [draft.companyId, draft]));
    const [fr, en] = await store.listCompanies();
    expect(byCompany.get(fr.id)?.language).toBe('fr');
    expect(byCompany.get(fr.id)?.body).toContain('Bonjour');
    expect(byCompany.get(en.id)?.language).toBe('en');
  });

  it('uses the researched language, track and one-liner when a dossier exists', async () => {
    const { store, layout, deps } = await setup([rawRow('acme.fr', { company: 'Acme Robotics' })]);
    const slug = slugFor('acme.fr');
    await writeCompanyFile(
      layout,
      slug,
      'dossier',
      dossierFor(await seedSnapshot(layout, slug), {
        language: 'en',
        one_liner: 'robots for warehouses all over Europe',
        fit: { score: 5, reasons: ['Fit'], track: 'swe' },
      }),
    );
    await processDossiers({ store, layout });

    await processGeneric(deps);

    const [company] = await store.listCompanies();
    const draft = await store.getLatestDraft(company.id);
    expect(draft).toMatchObject({ language: 'en', track: 'swe', resumePdfPath: 'storage/tracks/swe.pdf' });
    expect(draft?.body).toContain('Acme Robotics (robots for warehouses all over Europe)');
  });

  it('omits a researched one-liner and contact name that appear in no saved snapshot', async () => {
    const { store, layout, deps } = await setup([rawRow('acme.fr', { company: 'Acme Robotics' })]);
    const slug = slugFor('acme.fr');
    await writeCompanyFile(
      layout,
      slug,
      'dossier',
      dossierFor(await seedSnapshot(layout, slug), { one_liner: 'a fintech unicorn', contact_name: 'Dr Evil' }),
    );
    await processDossiers({ store, layout });

    await processGeneric(deps);

    const draft = await store.getLatestDraft((await store.listCompanies())[0].id);
    expect(draft?.body).not.toContain('fintech');
    expect(draft?.body.startsWith('Hello,')).toBe(true);
  });

  it('greets by the name given in the list even when the research found a name nobody can verify', async () => {
    const { store, layout, deps } = await setup([rawRow('acme.fr', { company: 'Acme Robotics', name: 'Claire Martin' })]);
    const slug = slugFor('acme.fr');
    await writeCompanyFile(layout, slug, 'dossier', dossierFor(await seedSnapshot(layout, slug), { contact_name: 'Dr Evil' }));
    await processDossiers({ store, layout });

    await processGeneric(deps);

    const draft = await store.getLatestDraft((await store.listCompanies())[0].id);
    expect(draft?.body.startsWith('Hi Claire,')).toBe(true);
  });

  it('keeps a researched contact name that appears in a saved snapshot', async () => {
    const { store, layout, deps } = await setup([rawRow('acme.fr', { company: 'Acme Robotics' })]);
    const slug = slugFor('acme.fr');
    await writeCompanyFile(layout, slug, 'dossier', dossierFor(await seedSnapshot(layout, slug), { contact_name: 'Acme' }));
    await processDossiers({ store, layout });

    await processGeneric(deps);

    const draft = await store.getLatestDraft((await store.listCompanies())[0].id);
    expect(draft?.body.startsWith('Hi Acme,')).toBe(true);
  });

  it('leaves dropped, needs_manual and finished companies alone', async () => {
    const { store, deps } = await setup([rawRow('acme.fr'), rawRow('beta.com'), rawRow('gamma.io')]);
    const [a, b] = await store.listCompanies();
    await store.updateCompany(a.id, { status: 'dropped', statusReason: 'fit 2 < 3' });
    await store.updateCompany(b.id, { status: 'needs_manual', statusReason: 'check' });

    const { results } = await processGeneric(deps);

    expect(results).toHaveLength(1);
    expect((await store.listCompanies()).map((company) => company.status)).toEqual(['dropped', 'needs_manual', 'awaiting_review']);
  });

  it('marks the company failed when the config lines push the email out of the critic bands', async () => {
    const { store, layout } = await setup([rawRow('acme.com', { company: 'Acme Robotics' })]);
    const long = { ...config.outreach.availability.en, ask_line: Array.from({ length: 120 }, () => 'summer 2027 internship').join(' ') };
    const bad = { ...config, outreach: { ...config.outreach, availability: { ...config.outreach.availability, en: long } } };

    const { results } = await processGeneric({ store, layout, config: bad, db });

    expect(results[0].outcome).toBe('failed');
    expect((await store.listCompanies())[0].status).toBe('failed');
    expect(existsSync(layout.companyFile(slugFor('acme.com'), 'critic'))).toBe(true);
  });

  it('is safe to run twice: the second run has nothing left to do', async () => {
    const { store, deps } = await setup([rawRow('acme.fr')]);
    await processGeneric(deps);
    expect((await processGeneric(deps)).results).toEqual([]);
    expect(store.drafts).toHaveLength(1);
  });
});

describe('assertTrackResumesExist', () => {
  it('refuses to start when a track resume has not been built', async () => {
    const paths = createTempPaths();
    const layout = layoutFor(paths);
    await expect(assertTrackResumesExist(layout)).resolves.toBeUndefined();
    const { rmSync } = await import('node:fs');
    rmSync(join(paths.storageDir, 'tracks', 'fullstack.pdf'));
    await expect(assertTrackResumesExist(layout)).rejects.toThrow(/track-resumes/);
  });
});

describe('resume logic (pending, status, summary)', () => {
  it('lists research work for ingested companies and writer work only for companies with verified claims', async () => {
    const { store, layout } = await setup([rawRow('acme.fr'), rawRow('beta.com'), rawRow('gamma.io')]);
    expect(await pendingSlugs(store, 'run-1', 'research')).toHaveLength(3);

    const [acme, beta] = [slugFor('acme.fr'), slugFor('beta.com')];
    await writeCompanyFile(layout, acme, 'dossier', dossierFor(await seedSnapshot(layout, acme)));
    await writeCompanyFile(layout, beta, 'dossier', dossierFor(await seedSnapshot(layout, beta), { claims: [] }));
    await processDossiers({ store, layout });

    expect(await pendingSlugs(store, 'run-1', 'research')).toEqual([slugFor('gamma.io')]);
    expect(await pendingSlugs(store, 'run-1', 'write')).toEqual([acme]);
    expect(await pendingSlugs(store, 'other-run', 'research')).toEqual([]);
  });

  it('summarises counts, generic drafts and everything that needs the user', async () => {
    const { store, deps } = await setup([rawRow('acme.fr'), rawRow('beta.com'), rawRow('gamma.io'), rawRow('delta.org')]);
    const [, , c, d] = await store.listCompanies();
    await store.updateCompany(c.id, { status: 'needs_manual', statusReason: 'defunct?' });
    await store.updateCompany(d.id, { status: 'dropped', statusReason: 'fit 2 < 3' });
    await processGeneric(deps);

    const text = await summaryText(store, 'run-1');

    expect(text).toContain('Run run-1: 4 companies');
    expect(text).toContain('awaiting_review 2');
    expect(text).toContain('2 generic');
    expect(text).toContain('Needs your decision');
    expect(text).toContain('defunct?');
    expect(text).toContain('fit 2 < 3');
  });

  it('lists sourced contacts with a low-confidence address, except for leads that are already dead', async () => {
    const { store } = await setup([rawRow('acme.fr', { company: 'Acme Labs' }), rawRow('beta.com', { company: 'Beta Labs' })]);
    const [acme, beta] = await store.listCompanies();
    await store.updateCompany(beta.id, { status: 'killed' });
    const note = (company: typeof acme, email: string, confidence: 'low' | 'normal') => ({
      slug: company.slug,
      company: company.name,
      email,
      email_source: 'pattern_guess' as const,
      contact_confidence: confidence,
    });

    const text = await summaryText(store, 'run-1', [note(acme, 'claire@acme.fr', 'low'), note(beta, 'x@beta.com', 'low')]);

    expect(text).toContain('Low-confidence contacts');
    expect(text).toContain('Acme Labs <claire@acme.fr> (pattern_guess, ingested)');
    expect(text).not.toContain('x@beta.com');
    expect(await summaryText(store, 'run-1', [note(acme, 'claire@acme.fr', 'normal')])).not.toContain('Low-confidence');
  });

  it('shows one status line per run', async () => {
    const { store } = await setup([rawRow('acme.fr')]);
    expect(await statusText(store)).toContain('run-1: 1 companies | ingested 1');
    expect(await statusText(new InMemoryOutreachStore())).toContain('No runs yet');
  });
});

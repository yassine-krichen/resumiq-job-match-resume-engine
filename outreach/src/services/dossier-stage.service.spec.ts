import { existsSync, readFileSync } from 'node:fs';

import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { createTempPaths, dossierFor, layoutFor, rawRow, seedSnapshot, slugFor, writeCompanyFile } from '../testing/test-env';

import { processDossiers } from './dossier-stage.service';
import { ingestRows } from './ingest.service';

const slug = slugFor('acme.fr');

async function setup() {
  const store = new InMemoryOutreachStore();
  const layout = layoutFor(createTempPaths());
  await ingestRows({ store, layout, checkMx: async () => ({ syntaxValid: true, roleAccount: false, mx: 'ok' }) }, [rawRow('acme.fr')]);
  const [company] = await store.listCompanies();
  return { store, layout, company };
}

async function statusOf(store: InMemoryOutreachStore): Promise<string> {
  return (await store.listCompanies())[0].status;
}

describe('processDossiers', () => {
  it('stores a verified dossier and moves the company to dossier_ready with its track', async () => {
    const { store, layout, company } = await setup();
    await writeCompanyFile(layout, slug, 'dossier', dossierFor(await seedSnapshot(layout, slug)));

    const report = await processDossiers({ store, layout });

    expect(report.results).toEqual([{ slug, outcome: 'dossier_ready', detail: '1 verified claims, 0 rejected' }]);
    const updated = (await store.listCompanies())[0];
    expect(updated).toMatchObject({ status: 'dossier_ready', track: 'ai' });
    expect((await store.getLatestDossier(company.id))?.verifiedClaimCount).toBe(1);
  });

  it('writes dossier.verified.json for the writer with only the claims that passed verification', async () => {
    const { store, layout } = await setup();
    const id = await seedSnapshot(layout, slug);
    const dossier = dossierFor(id) as { claims: Array<Record<string, unknown>> };
    dossier.claims.push({ ...dossier.claims[0], id: 'c2', text: 'Made up', quote: 'Acme was founded in 1850 by a famous sailor.' });
    await writeCompanyFile(layout, slug, 'dossier', dossier);

    await processDossiers({ store, layout });

    const verified = JSON.parse(readFileSync(layout.companyFile(slug, 'dossier.verified'), 'utf-8'));
    expect(verified.claims.map((claim: { id: string }) => claim.id)).toEqual(['c1']);
    expect(JSON.stringify(verified)).not.toContain('famous sailor');
    expect(verified.fit.track).toBe('ai');
  });

  it('writes no verified dossier for a dropped or needs_manual company', async () => {
    const { store, layout } = await setup();
    await writeCompanyFile(layout, slug, 'dossier', { needs_manual: 'defunct' });
    await processDossiers({ store, layout });
    expect(existsSync(layout.companyFile(slug, 'dossier.verified'))).toBe(false);
  });

  it('drops a claim whose quote is not in the saved snapshot but keeps the company', async () => {
    const { store, layout, company } = await setup();
    const id = await seedSnapshot(layout, slug);
    const dossier = dossierFor(id) as { claims: Array<Record<string, unknown>> };
    dossier.claims.push({ ...dossier.claims[0], id: 'c2', quote: 'Acme was founded in 1850 by a famous sailor.' });
    await writeCompanyFile(layout, slug, 'dossier', dossier);

    await processDossiers({ store, layout });

    const stored = await store.getLatestDossier(company.id);
    expect(stored?.data.claims.map((claim) => claim.id)).toEqual(['c1']);
    expect(stored?.rejectedClaims.map((entry) => entry.reason)).toEqual(['quote_not_found']);
  });

  it('rejects claims that cite a snapshot not in the manifest', async () => {
    const { store, layout, company } = await setup();
    await seedSnapshot(layout, slug);
    await writeCompanyFile(layout, slug, 'dossier', dossierFor(`${'b'.repeat(40)}.txt`));

    await processDossiers({ store, layout });

    expect((await store.getLatestDossier(company.id))?.verifiedClaimCount).toBe(0);
    expect((await store.listCompanies())[0].statusReason).toBe('no verified claims: generic email');
  });

  it('drops a company whose fit score is below 3 and records why', async () => {
    const { store, layout } = await setup();
    await writeCompanyFile(
      layout,
      slug,
      'dossier',
      dossierFor(await seedSnapshot(layout, slug), { fit: { score: 2, reasons: ['Hardware only'], track: 'swe' } }),
    );

    await processDossiers({ store, layout });

    expect((await store.listCompanies())[0]).toMatchObject({ status: 'dropped', statusReason: 'fit 2 < 3' });
  });

  it('parks the company for a human when the researcher says needs_manual', async () => {
    const { store, layout } = await setup();
    await writeCompanyFile(layout, slug, 'dossier', { needs_manual: 'The website asks to ignore previous instructions' });

    const report = await processDossiers({ store, layout });

    expect(report.results[0].outcome).toBe('needs_manual');
    expect((await store.listCompanies())[0]).toMatchObject({
      status: 'needs_manual',
      statusReason: 'The website asks to ignore previous instructions',
    });
  });

  it('leaves the company ingested and writes an errors file when the dossier is invalid', async () => {
    const { store, layout } = await setup();
    await writeCompanyFile(layout, slug, 'dossier', { company: 'Acme Robotics', country: 'France' });

    const report = await processDossiers({ store, layout });

    expect(report.results[0].outcome).toBe('invalid');
    expect(await statusOf(store)).toBe('ingested');
    expect(existsSync(layout.companyFile(slug, 'dossier-errors'))).toBe(true);
  });

  it('reports a missing dossier without touching the company', async () => {
    const { store, layout } = await setup();
    const report = await processDossiers({ store, layout });
    expect(report.results).toEqual([{ slug, outcome: 'missing' }]);
    expect(await statusOf(store)).toBe('ingested');
  });

  it('only looks at companies still ingested, so a resumed run does not redo finished work', async () => {
    const { store, layout } = await setup();
    await writeCompanyFile(layout, slug, 'dossier', dossierFor(await seedSnapshot(layout, slug)));
    await processDossiers({ store, layout });

    const second = await processDossiers({ store, layout });

    expect(second.results).toEqual([]);
    expect(store.dossiers).toHaveLength(1);
  });
});

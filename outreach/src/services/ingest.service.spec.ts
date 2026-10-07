import { existsSync, readFileSync } from 'node:fs';

import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { createTempPaths, layoutFor, rawRow, slugFor } from '../testing/test-env';

import { appendNormalizedRows, ingestRows } from './ingest.service';
import type { MxChecker } from './ingest.service';

const mxOk: MxChecker = async (email) => ({ syntaxValid: true, roleAccount: /^(info|contact)@/.test(email), mx: 'ok' });

function setup() {
  const store = new InMemoryOutreachStore();
  const layout = layoutFor(createTempPaths());
  return { store, layout, deps: { store, layout, checkMx: mxOk } };
}

describe('ingestRows', () => {
  it('inserts valid rows as ingested companies and writes input.json for the agents', async () => {
    const { store, layout, deps } = setup();
    const report = await ingestRows(deps, [rawRow('acme.fr', { name: 'Claire' }), rawRow('beta.io')]);

    expect(report.inserted.map((entry) => entry.company)).toEqual(['Company acme.fr', 'Company beta.io']);
    const companies = await store.listCompanies({ runId: 'run-1' });
    expect(companies.map((company) => company.status)).toEqual(['ingested', 'ingested']);
    expect(existsSync(layout.companyFile(slugFor('acme.fr'), 'input'))).toBe(true);
    expect((await store.getContact(companies[0].id))?.name).toBe('Claire');
  });

  it('reports invalid rows without losing the valid ones', async () => {
    const { deps } = setup();
    const report = await ingestRows(deps, [rawRow('acme.fr'), { company: 'No email' }, { company: 'Bad', email: 'a@b@c' }]);
    expect(report.inserted).toHaveLength(1);
    expect(report.invalid.map((row) => row.index)).toEqual([1, 2]);
  });

  it('drops a duplicate inside the list and keeps the first row', async () => {
    const { deps } = setup();
    const report = await ingestRows(deps, [rawRow('acme.fr', { company: 'First' }), rawRow('acme.fr', { company: 'Second' })]);
    expect(report.inserted.map((entry) => entry.company)).toEqual(['First']);
    expect(report.dropped).toEqual([{ company: 'Second', email: 'claire@acme.fr', reason: 'duplicate_in_list' }]);
  });

  it('drops companies already in the DB from an earlier run', async () => {
    const { store, deps } = setup();
    await ingestRows(deps, [rawRow('acme.fr')]);
    const second = await ingestRows({ ...deps, layout: layoutFor(deps.layout.paths, 'run-2') }, [rawRow('acme.fr'), rawRow('beta.io')]);
    expect(second.dropped.map((entry) => entry.reason)).toEqual(['already_in_database']);
    expect((await store.listCompanies({ runId: 'run-2' })).map((company) => company.name)).toEqual(['Company beta.io']);
  });

  it('is idempotent: ingesting the same file twice inserts nothing the second time', async () => {
    const { store, deps } = setup();
    const rows = [rawRow('acme.fr'), rawRow('beta.io')];
    await ingestRows(deps, rows);
    const again = await ingestRows(deps, rows);
    expect(again.inserted).toEqual([]);
    expect(await store.listCompanies()).toHaveLength(2);
  });

  it('drops suppressed addresses and domains, subdomains included, before anything else', async () => {
    const { store, deps } = setup();
    store.suppressions = { emails: ['claire@gamma.org'], domains: ['acme.fr'] };
    const report = await ingestRows(deps, [
      rawRow('acme.fr'),
      rawRow('cs.acme.fr', { email: 'bob@cs.acme.fr' }),
      rawRow('gamma.org'),
      rawRow('beta.io'),
    ]);
    expect(report.dropped.map((entry) => entry.reason)).toEqual(['suppressed_domain', 'suppressed_domain', 'suppressed_email']);
    expect(report.inserted.map((entry) => entry.company)).toEqual(['Company beta.io']);
  });

  it('drops a domain that cannot receive mail and keeps one whose lookup failed', async () => {
    const { deps } = setup();
    const checkMx: MxChecker = async (email) => ({
      syntaxValid: true,
      roleAccount: false,
      mx: email.endsWith('@dead.example') ? 'none' : 'unknown',
    });
    const report = await ingestRows({ ...deps, checkMx }, [rawRow('dead.example'), rawRow('flaky.io')]);
    expect(report.dropped).toEqual([{ company: 'Company dead.example', email: 'claire@dead.example', reason: 'mx_none' }]);
    expect(report.inserted.map((entry) => entry.mx)).toEqual(['unknown']);
  });

  it('flags role accounts such as info@ for the reviewer', async () => {
    const { store, deps } = setup();
    await ingestRows(deps, [rawRow('acme.fr', { email: 'info@acme.fr' })]);
    const [company] = await store.listCompanies();
    expect((await store.getContact(company.id))?.roleAccount).toBe(true);
  });

  it('treats a lost insert race as already_in_database instead of crashing', async () => {
    const { store, deps } = setup();
    const insert = store.insertCompany.bind(store);
    store.insertCompany = async (input) => {
      await insert(input);
      return insert(input);
    };
    const report = await ingestRows(deps, [rawRow('acme.fr')]);
    expect(report.dropped).toEqual([{ company: 'Company acme.fr', email: 'claire@acme.fr', reason: 'already_in_database' }]);
  });

  it('records an ingest event and a report file', async () => {
    const { store, layout, deps } = setup();
    await ingestRows(deps, [rawRow('acme.fr')]);
    expect(existsSync(layout.ingestReportFile)).toBe(true);
    expect(store.events.at(-1)).toMatchObject({ type: 'ingest.finished', payload: { inserted: 1 } });
  });

  it('appends to an existing run: a second ingest with the same run id adds companies to it', async () => {
    const { store, layout, deps } = setup();
    await ingestRows(deps, [rawRow('acme.fr')]);
    await ingestRows(deps, [rawRow('acme.fr'), rawRow('beta.io')]);

    expect((await store.listCompanies({ runId: 'run-1' })).map((company) => company.name)).toEqual([
      'Company acme.fr',
      'Company beta.io',
    ]);
    const report = JSON.parse(readFileSync(layout.ingestReportFile, 'utf-8'));
    expect(report.reports).toHaveLength(2);
    expect(report.reports[0].inserted).toHaveLength(1);
    expect(report.reports[1].inserted).toHaveLength(1);
  });
});

describe('appendNormalizedRows', () => {
  it('keeps the rows of earlier ingests and adds new ones without duplicating identical rows', async () => {
    const layout = layoutFor(createTempPaths());
    await appendNormalizedRows(layout, [rawRow('acme.fr')]);
    await appendNormalizedRows(layout, [rawRow('acme.fr'), rawRow('beta.io')]);
    const saved = JSON.parse(readFileSync(layout.normalizedFile, 'utf-8'));
    expect(saved.map((row: { email: string }) => row.email)).toEqual(['claire@acme.fr', 'claire@beta.io']);
  });
});
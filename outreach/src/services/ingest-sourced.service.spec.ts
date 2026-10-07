import { readFileSync } from 'node:fs';

import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { createTempPaths, layoutFor } from '../testing/test-env';

import { ingestSourced, readSourcedContacts } from './ingest-sourced.service';
import type { MxChecker } from './ingest.service';
import { writeJsonAtomic } from './run-layout';
import type { RunLayout } from './run-layout';
import { snapshotUrl } from './snapshot.service';

const mxOk: MxChecker = async () => ({ syntaxValid: true, roleAccount: false, mx: 'ok' });
const mxUnknown: MxChecker = async () => ({ syntaxValid: true, roleAccount: false, mx: 'unknown' });

const PAGE = 'Join us. Questions about jobs? Write to Claire Martin, our CTO, at claire@acme.fr and we will answer within a week.';

async function setup(pageUrl = 'https://acme.fr/careers') {
  const store = new InMemoryOutreachStore();
  const layout = layoutFor(createTempPaths());
  const fetchFn = async (): Promise<Response> =>
    new Response(`<html><body><p>${PAGE}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  const saved = await snapshotUrl(pageUrl, layout.sourcingSnapshotsDir, {
    fetchFn: fetchFn as unknown as typeof fetch,
    resolveHost: async () => ['93.184.216.34'],
  });
  return { store, layout, snapshotId: saved.snapshotId };
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company: 'Acme Robotics',
    website: 'https://acme.fr',
    why: 'Small remote-friendly robotics team that hires interns',
    contact_name: 'Claire Martin',
    contact_role: 'CTO',
    email: 'claire@acme.fr',
    email_source: 'page_quote',
    ...overrides,
  };
}

async function write(layout: RunLayout, candidates: unknown[]): Promise<void> {
  await writeJsonAtomic(layout.sourcingCandidatesFile, { candidates });
}

function inputOf(layout: RunLayout, slug: string): Record<string, unknown> {
  return JSON.parse(readFileSync(layout.companyFile(slug, 'input'), 'utf-8')) as Record<string, unknown>;
}

describe('ingestSourced', () => {
  it('inserts a company whose emailed address is quoted from a saved page, marked as sourced', async () => {
    const { store, layout, snapshotId } = await setup();
    await write(layout, [candidate({ evidence: { snapshot_id: snapshotId, quote: 'Write to Claire Martin, our CTO, at claire@acme.fr and we will answer' } })]);

    const report = await ingestSourced({ store, layout, checkMx: mxOk });

    expect(report.rejected).toEqual([]);
    expect(report.ingest?.inserted.map((entry) => entry.email)).toEqual(['claire@acme.fr']);
    const [company] = await store.listCompanies({ runId: layout.runId });
    expect(company.status).toBe('ingested');
    expect(await store.getContact(company.id)).toMatchObject({
      email: 'claire@acme.fr',
      name: 'Claire Martin',
      role: 'CTO',
      emailSource: 'page_quote',
      contactConfidence: 'normal',
    });
    expect(inputOf(layout, company.slug)).toMatchObject({
      source: 'sourced',
      email_source: 'page_quote',
      contact_confidence: 'normal',
      why: 'Small remote-friendly robotics team that hires interns',
      evidence: { url: 'https://acme.fr/careers' },
    });
    expect(store.events.some((event) => event.type === 'contact.sourced' && event.companyId === company.id)).toBe(true);
    expect(JSON.parse(readFileSync(layout.normalizedFile, 'utf-8'))).toHaveLength(1);
  });

  describe('where a quoted address was read', () => {
    const quote = 'Write to Claire Martin, our CTO, at claire@acme.fr and we will answer';

    it('downgrades an address quoted from a third-party page to low confidence', async () => {
      const { store, layout, snapshotId } = await setup('https://directory.example/companies/acme');
      await write(layout, [candidate({ evidence: { snapshot_id: snapshotId, quote } })]);

      const report = await ingestSourced({ store, layout, checkMx: mxOk });

      expect(report.contacts[0]).toMatchObject({ email_source: 'page_quote', contact_confidence: 'low' });
      const [company] = await store.listCompanies();
      expect(await store.getContact(company.id)).toMatchObject({ contactConfidence: 'low' });
    });

    it('keeps normal confidence when the page belongs to the website the candidate names', async () => {
      const { store, layout, snapshotId } = await setup('https://www.acme-group.example/team');
      await write(layout, [candidate({ website: 'https://acme-group.example', evidence: { snapshot_id: snapshotId, quote } })]);

      expect((await ingestSourced({ store, layout, checkMx: mxOk })).contacts[0]).toMatchObject({ contact_confidence: 'normal' });
    });
  });

  it.each([
    ['a quote that does not contain the address', { quote: 'Questions about jobs? Write to Claire Martin, our CTO' }, 'quote_missing_email'],
    ['a quote that is not on the saved page', { quote: 'Contact us at claire@acme.fr for anything at all today' }, 'quote_not_found'],
  ])('rejects %s', async (_name, evidence, reason) => {
    const { store, layout, snapshotId } = await setup();
    await write(layout, [candidate({ evidence: { snapshot_id: snapshotId, ...evidence } })]);

    const report = await ingestSourced({ store, layout, checkMx: mxOk });

    expect(report.rejected).toMatchObject([{ company: 'Acme Robotics', reason }]);
    expect(await store.listCompanies()).toEqual([]);
  });

  it('rejects evidence from a snapshot the manifest does not list', async () => {
    const { store, layout } = await setup();
    await write(layout, [candidate({ evidence: { snapshot_id: 'f'.repeat(40) + '.txt', quote: 'Write to Claire Martin at claire@acme.fr' } })]);

    const report = await ingestSourced({ store, layout, checkMx: mxOk });

    expect(report.rejected).toMatchObject([{ reason: 'snapshot_missing' }]);
  });

  it('rejects an unsafe snapshot id instead of reading a path from it', async () => {
    const { store, layout } = await setup();
    await write(layout, [candidate({ evidence: { snapshot_id: '../../../.env', quote: 'Write to Claire Martin at claire@acme.fr' } })]);

    expect((await ingestSourced({ store, layout, checkMx: mxOk })).rejected).toMatchObject([{ reason: 'snapshot_missing' }]);
  });

  it('allows a guessed address only when the domain has mail, and flags it low confidence', async () => {
    const { store, layout } = await setup();
    await write(layout, [candidate({ email_source: 'pattern_guess', email: 'claire.martin@acme.fr' })]);

    const report = await ingestSourced({ store, layout, checkMx: mxOk });

    expect(report.contacts).toEqual([
      { slug: expect.any(String), company: 'Acme Robotics', email: 'claire.martin@acme.fr', email_source: 'pattern_guess', contact_confidence: 'low' },
    ]);
    const [company] = await store.listCompanies();
    expect(inputOf(layout, company.slug)).toMatchObject({ contact_confidence: 'low', email_source: 'pattern_guess' });
    expect(await store.getContact(company.id)).toMatchObject({ emailSource: 'pattern_guess', contactConfidence: 'low' });
  });

  it.each([
    ['inconclusive', mxUnknown],
    ['unchecked', async () => ({ syntaxValid: true, roleAccount: false, mx: 'unchecked' as const })],
    ['absent', async () => ({ syntaxValid: true, roleAccount: false, mx: 'none' as const })],
  ])('rejects a guessed address when the MX check is %s', async (_name, checkMx) => {
    const { store, layout } = await setup();
    await write(layout, [candidate({ email_source: 'pattern_guess', email: 'claire.martin@acme.fr' })]);

    const report = await ingestSourced({ store, layout, checkMx });

    expect(report.rejected).toMatchObject([{ reason: 'pattern_guess_needs_mx_ok' }]);
    expect(await store.listCompanies()).toEqual([]);
  });

  describe('hunter addresses', () => {
    async function withHunterFile(layout: RunLayout, confidence: number): Promise<void> {
      await writeJsonAtomic(layout.hunterFile('acme.fr'), {
        domain: 'acme.fr',
        fetchedAt: '2026-10-07T10:00:00.000Z',
        emails: [{ email: 'claire@acme.fr', name: 'Claire Martin', position: 'CTO', confidence, type: 'personal' }],
      });
    }

    it('accepts an address Hunter returned and trusts it when Hunter was confident', async () => {
      const { store, layout } = await setup();
      await withHunterFile(layout, 93);
      await write(layout, [candidate({ email_source: 'hunter' })]);

      const report = await ingestSourced({ store, layout, checkMx: mxOk });

      expect(report.contacts[0]).toMatchObject({ email_source: 'hunter', contact_confidence: 'normal' });
    });

    it('flags a low-scored Hunter address', async () => {
      const { store, layout } = await setup();
      await withHunterFile(layout, 55);
      await write(layout, [candidate({ email_source: 'hunter' })]);

      expect((await ingestSourced({ store, layout, checkMx: mxOk })).contacts[0]).toMatchObject({ contact_confidence: 'low' });
    });

    it('rejects a hunter source for an address Hunter never returned', async () => {
      const { store, layout } = await setup();
      await withHunterFile(layout, 93);
      await write(layout, [candidate({ email_source: 'hunter', email: 'someone.else@acme.fr' })]);

      expect((await ingestSourced({ store, layout, checkMx: mxOk })).rejected).toMatchObject([{ reason: 'hunter_address_unknown' }]);
    });

    it('rejects a hunter source when no Hunter lookup was saved for the domain', async () => {
      const { store, layout } = await setup();
      await write(layout, [candidate({ email_source: 'hunter' })]);

      expect((await ingestSourced({ store, layout, checkMx: mxOk })).rejected).toMatchObject([{ reason: 'hunter_address_unknown' }]);
    });
  });

  it('rejects a candidate without an address', async () => {
    const { store, layout } = await setup();
    await write(layout, [candidate({ email: null, email_source: null })]);

    expect((await ingestSourced({ store, layout, checkMx: mxOk })).rejected).toMatchObject([{ reason: 'no_email' }]);
  });

  it('reports a malformed candidate and still ingests the others', async () => {
    const { store, layout, snapshotId } = await setup();
    const good = candidate({ evidence: { snapshot_id: snapshotId, quote: 'Write to Claire Martin, our CTO, at claire@acme.fr and we will answer' } });
    await write(layout, [{ company: 'No site' }, candidate({ email_source: undefined }), candidate({ email_source: 'page_quote' }), good]);

    const report = await ingestSourced({ store, layout, checkMx: mxOk });

    expect(report.invalid.map((entry) => entry.index)).toEqual([0, 1, 2]);
    expect(report.ingest?.inserted).toHaveLength(1);
  });

  it('drops companies already in the database and addresses on the suppression list', async () => {
    const { store, layout } = await setup();
    await store.insertCompany({
      runId: 'run-0',
      slug: 'old-acme',
      name: 'Old Acme',
      domain: 'acme.fr',
      domainKey: 'acme.fr',
      website: null,
      contact: { email: 'x@acme.fr', name: null, role: null, roleAccount: false, mxStatus: 'ok' },
    });
    store.suppressions = { emails: ['stop@beta.io'], domains: [] };
    await write(layout, [
      candidate({ email_source: 'pattern_guess' }),
      candidate({ company: 'Beta', website: 'https://beta.io', email: 'stop@beta.io', email_source: 'pattern_guess' }),
    ]);

    const report = await ingestSourced({ store, layout, checkMx: mxOk });

    expect(report.ingest?.dropped.map((entry) => entry.reason)).toEqual(['already_in_database', 'suppressed_email']);
    expect(report.ingest?.inserted).toEqual([]);
  });

  it('inserts at most the limit and reports the rest as over the limit', async () => {
    const { store, layout } = await setup();
    const rows = ['one.io', 'two.io', 'three.io'].map((domain) =>
      candidate({ company: `Company ${domain}`, website: `https://${domain}`, email: `a@${domain}`, email_source: 'pattern_guess' }),
    );
    await write(layout, rows);

    const report = await ingestSourced({ store, layout, checkMx: mxOk, limit: 2 });

    expect(report.ingest?.inserted.map((entry) => entry.company)).toEqual(['Company one.io', 'Company two.io']);
    expect(report.rejected).toMatchObject([{ company: 'Company three.io', reason: 'over_limit' }]);
  });

  it('fails clearly when the sourcer wrote no candidates file or an unreadable one', async () => {
    const { store, layout } = await setup();
    await expect(ingestSourced({ store, layout, checkMx: mxOk })).rejects.toThrow(/candidates\.json/);

    await writeJsonAtomic(layout.sourcingCandidatesFile, { rows: [] });
    await expect(ingestSourced({ store, layout, checkMx: mxOk })).rejects.toThrow(/candidates/);
  });

  it('is safe to run twice: the second run inserts nothing and the low-confidence list is kept', async () => {
    const { store, layout } = await setup();
    await write(layout, [candidate({ email_source: 'pattern_guess' })]);

    await ingestSourced({ store, layout, checkMx: mxOk });
    const second = await ingestSourced({ store, layout, checkMx: mxOk });

    expect(second.ingest?.inserted).toEqual([]);
    expect(await store.listCompanies()).toHaveLength(1);
    expect(await readSourcedContacts(layout)).toMatchObject([{ company: 'Acme Robotics', contact_confidence: 'low' }]);
  });
});

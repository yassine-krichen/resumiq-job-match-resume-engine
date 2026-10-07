import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CompanyStatus } from '../db/outreach-store';
import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { seedDraft } from '../testing/seed';
import { createTempPaths, layoutFor, rawRow } from '../testing/test-env';
import type { OutreachPaths } from '../config/paths';

import { ingestRows } from './ingest.service';
import { REPLY_WATCH_DAYS } from '../send/tick.service';

import { MIN_PRUNE_DAYS, pruneDeadLeads } from './prune.service';
import { writeJsonAtomic } from './run-layout';
import type { RunLayout } from './run-layout';

const NOW = new Date('2027-04-01T12:00:00Z');
const DAY = 24 * 60 * 60_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

interface Lead {
  slug: string;
  id: string;
  domain: string;
}

/** A company with a dossier, a draft, run files and a stored PDF, last changed `ageDays` ago. */
async function addLead(
  store: InMemoryOutreachStore,
  paths: OutreachPaths,
  domain: string,
  status: CompanyStatus,
  ageDays: number,
): Promise<Lead> {
  store.clock = () => daysAgo(ageDays);
  const { company } = await seedDraft(store, domain);
  await store.updateCompany(company.id, { status });
  const layout = layoutFor(paths, company.runId);
  await writeJsonAtomic(layout.companyFile(company.slug, 'input'), { company: company.name, email: `claire@${domain}` });
  const pdf = join(layout.storageDir(company.slug), 'resume-1.pdf');
  mkdirSync(dirname(pdf), { recursive: true });
  writeFileSync(pdf, '%PDF-fake');
  return { slug: company.slug, id: company.id, domain };
}

function setup() {
  const store = new InMemoryOutreachStore();
  const paths = createTempPaths();
  const layout: RunLayout = layoutFor(paths);
  return { store, paths, layout };
}

describe('pruneDeadLeads', () => {
  it('prunes killed, dropped and sent-without-reply leads older than the limit and keeps everything else', async () => {
    const { store, paths } = setup();
    const killed = await addLead(store, paths, 'killed.fr', 'killed', 200);
    const dropped = await addLead(store, paths, 'dropped.fr', 'dropped', 181);
    const sent = await addLead(store, paths, 'sent.fr', 'sent', 365);
    const recentKilled = await addLead(store, paths, 'recent.fr', 'killed', 179);
    const kept = await Promise.all(
      (['replied', 'bounced', 'awaiting_review', 'approved', 'scheduled', 'needs_manual', 'failed', 'ingested'] as const).map((status) =>
        addLead(store, paths, `${status.replace('_', '-')}.io`, status, 400),
      ),
    );

    const report = await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    expect(report.pruned.map((entry) => entry.slug).sort()).toEqual([killed.slug, dropped.slug, sent.slug].sort());
    for (const lead of [killed, dropped, sent]) expect(await store.getContact(lead.id)).toBeNull();
    for (const lead of [recentKilled, ...kept]) expect(await store.getContact(lead.id)).not.toBeNull();
  });

  it('erases contacts, dossiers and draft text but keeps the company row with its domain key and status', async () => {
    const { store, paths } = setup();
    const lead = await addLead(store, paths, 'killed.fr', 'killed', 200);

    await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    expect(await store.getContact(lead.id)).toBeNull();
    expect(await store.getLatestDossier(lead.id)).toBeNull();
    const draft = await store.getLatestDraft(lead.id);
    expect(draft).toMatchObject({ subject: '', body: '', followUpBody: '', cta: '', anchorPhrase: null, tailoring: null, resumePdfPath: '' });
    expect(await store.getCompany(lead.id)).toMatchObject({ status: 'killed', domainKey: 'killed.fr' });
    expect(store.events.some((event) => event.type === 'company.pruned' && event.companyId === lead.id)).toBe(true);
  });

  it('still recognises a pruned company as a duplicate when the same domain is ingested again', async () => {
    const { store, paths, layout } = setup();
    await addLead(store, paths, 'killed.fr', 'killed', 200);
    await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    const report = await ingestRows(
      { store, layout, checkMx: async () => ({ syntaxValid: true, roleAccount: false, mx: 'ok' }) },
      [rawRow('killed.fr')],
    );

    expect(report.dropped.map((entry) => entry.reason)).toEqual(['already_in_database']);
  });

  it('never touches the suppression list', async () => {
    const { store, paths } = setup();
    store.suppressions = { emails: ['stop@old.io'], domains: ['blocked.com'] };
    await addLead(store, paths, 'killed.fr', 'killed', 200);

    await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    expect(store.suppressions).toEqual({ emails: ['stop@old.io'], domains: ['blocked.com'] });
  });

  it('removes the company folder and the stored PDFs, and the whole run folder once every company of it is pruned', async () => {
    const { store, paths, layout } = setup();
    const lead = await addLead(store, paths, 'killed.fr', 'killed', 200);
    await writeJsonAtomic(layout.normalizedFile, [{ company: 'Killed', email: 'claire@killed.fr' }]);

    const report = await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    expect(existsSync(layout.companyDir(lead.slug))).toBe(false);
    expect(existsSync(layout.storageDir(lead.slug))).toBe(false);
    expect(existsSync(layout.runDir)).toBe(false);
    expect(report.removedRunFolders).toEqual([layout.runId]);
  });

  it('keeps the run folder while another company of the run still needs it', async () => {
    const { store, paths, layout } = setup();
    const dead = await addLead(store, paths, 'killed.fr', 'killed', 200);
    const alive = await addLead(store, paths, 'alive.fr', 'awaiting_review', 200);
    await writeJsonAtomic(layout.normalizedFile, []);

    const report = await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    expect(existsSync(layout.companyDir(dead.slug))).toBe(false);
    expect(existsSync(layout.companyDir(alive.slug))).toBe(true);
    expect(existsSync(layout.normalizedFile)).toBe(true);
    expect(report.removedRunFolders).toEqual([]);
  });

  it('never removes the shared track resumes', async () => {
    const { store, paths } = setup();
    await addLead(store, paths, 'killed.fr', 'killed', 200);
    await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });
    expect(existsSync(join(paths.storageDir, 'tracks', 'ai.pdf'))).toBe(true);
  });

  it('changes nothing in a dry run but reports what it would do', async () => {
    const { store, paths, layout } = setup();
    const lead = await addLead(store, paths, 'killed.fr', 'killed', 200);

    const report = await pruneDeadLeads({ store, paths, days: 180, dryRun: true, now: () => NOW });

    expect(report).toMatchObject({ dryRun: true, pruned: [{ slug: lead.slug, status: 'killed' }], removedRunFolders: [layout.runId] });
    expect(await store.getContact(lead.id)).not.toBeNull();
    expect(existsSync(layout.companyDir(lead.slug))).toBe(true);
    expect(store.events.some((event) => event.type === 'company.pruned')).toBe(false);
  });

  it('leaves a sent lead alone while a send of it is still waiting to go out', async () => {
    const { store, paths } = setup();
    const lead = await addLead(store, paths, 'sent.fr', 'sent', 365);
    const draft = await store.getLatestDraft(lead.id);
    if (!draft) throw new Error('seed failed');
    await store.createSend({ draftId: draft.id, kind: 'follow_up', scheduledAt: daysAgo(-1) });

    const report = await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    expect(report.pruned).toEqual([]);
    expect(report.skippedActiveSends).toBe(1);
    expect(await store.getContact(lead.id)).not.toBeNull();
  });

  it('does nothing the second time: pruned leads are not reported again', async () => {
    const { store, paths } = setup();
    await addLead(store, paths, 'killed.fr', 'killed', 200);
    await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    const second = await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    expect(second.pruned).toEqual([]);
    expect(second.alreadyPruned).toBe(1);
  });

  it('honours --days', async () => {
    const { store, paths } = setup();
    const lead = await addLead(store, paths, 'killed.fr', 'killed', 40);

    expect((await pruneDeadLeads({ store, paths, days: 180, dryRun: true, now: () => NOW })).pruned).toEqual([]);
    expect((await pruneDeadLeads({ store, paths, days: 30, dryRun: true, now: () => NOW })).pruned.map((entry) => entry.slug)).toEqual([lead.slug]);
  });

  it('refuses a limit shorter than the reply watch plus the follow-up delay, so no sent lead is erased while it can still answer', () => {
    expect(MIN_PRUNE_DAYS).toBeGreaterThanOrEqual(REPLY_WATCH_DAYS + 7);
  });

  it('clears the payload of every event of a pruned company (they hold draft text) and leaves other companies alone', async () => {
    const { store, paths } = setup();
    const dead = await addLead(store, paths, 'killed.fr', 'killed', 200);
    const alive = await addLead(store, paths, 'alive.fr', 'awaiting_review', 200);
    await store.recordEvent(dead.id, 'draft.verification_failed', { issues: [{ text: 'We love your Series B.' }], reason: 'x' });
    await store.recordEvent(dead.id, 'draft.approved_despite', { reason: 'the sentence "We love your Series B."' });
    await store.recordEvent(alive.id, 'draft.verification_failed', { reason: 'keep me' });

    await pruneDeadLeads({ store, paths, days: 180, dryRun: false, now: () => NOW });

    const own = store.events.filter((event) => event.companyId === dead.id);
    expect(own.map((event) => event.type)).toEqual(expect.arrayContaining(['draft.verification_failed', 'draft.approved_despite', 'company.pruned']));
    expect(JSON.stringify(own.map((event) => event.payload))).not.toContain('Series B');
    expect(store.events.find((event) => event.companyId === alive.id && event.type === 'draft.verification_failed')?.payload).toEqual({ reason: 'keep me' });
  });

  it.each([0, -5, 1.5, 29, Number.NaN])('rejects %s days', async (days) => {
    const { store, paths } = setup();
    await expect(pruneDeadLeads({ store, paths, days, dryRun: true, now: () => NOW })).rejects.toThrow(/days/);
  });
});

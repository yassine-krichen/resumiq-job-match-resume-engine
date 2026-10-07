import type { SendRecord } from '../db/outreach-store';
import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { seedDraft } from '../testing/seed';
import { loadExampleConfig, loadExampleInventory } from '../testing/test-env';

import { buildDetailLines, wrapText } from './detail-lines';
import { buildPipeline, filterItems, loadReviewItems } from './review-items';

const context = { config: loadExampleConfig(), db: loadExampleInventory() };

async function seeded(): Promise<InMemoryOutreachStore> {
  const store = new InMemoryOutreachStore();
  await seedDraft(store, 'acme.example', { name: 'Acme Robotics', subject: 'Your fleet scheduler' });
  await seedDraft(store, 'beta.example', { name: 'Beta Labs', generic: true, country: 'DE' });
  await seedDraft(store, 'gamma.example', { name: 'Gamma', decision: 'approved' });
  return store;
}

describe('loadReviewItems', () => {
  it('lists drafts awaiting review and decided-but-unsent ones, each with the checks run now', async () => {
    const store = await seeded();
    const { company: killed } = await seedDraft(store, 'killed.example', { name: 'Killed Inc' });
    await store.updateCompany(killed.id, { status: 'killed' });

    const items = await loadReviewItems(store, context);

    expect(items.map((item) => item.company.slug)).toEqual(['acme-example', 'beta-example', 'gamma-example']);
    expect(items[0].failures).toEqual([]);
    expect(items[0].dossier?.data.fit.score).toBe(4);
  });

  it('reports a draft that breaks a rule now, so it cannot be approved', async () => {
    const store = await seeded();
    const [draft] = store.drafts;
    draft.subject = 'Great news!';

    const items = await loadReviewItems(store, context);

    expect(items[0].failures.map((failure) => failure.rule)).toContain('subject_exclamation');
  });

  it('notes a generic draft, a track resume and a role address', async () => {
    const store = await seeded();
    const beta = [...store.contacts.values()][1];
    beta.roleAccount = true;

    const items = await loadReviewItems(store, context);

    expect(items[1].notes.join(' ')).toMatch(/Generic draft/);
    expect(items[1].notes.join(' ')).toMatch(/Track resume/);
    expect(items[1].notes.join(' ')).toMatch(/Role address/);
  });
});

describe('failed sends in the list', () => {
  it('lists a company whose follow-up failed even though its status is sent', async () => {
    const store = new InMemoryOutreachStore();
    const { draft, company } = await seedDraft(store, 'acme.example', { decision: 'approved' });
    const initial = await store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: new Date() });
    await store.claimSend(initial?.id as string);
    await store.completeSend(initial?.id as string, { sentAt: new Date(), providerMessageId: '<a@b>', providerThreadId: 't' });
    const followUp = await store.createSend({ draftId: draft.id, kind: 'follow_up', scheduledAt: new Date() });
    await store.updateSend(followUp?.id as string, { status: 'failed', error: 'Gmail API 400' });

    const items = await loadReviewItems(store, context);

    expect((await store.getCompany(company.id))?.status).toBe('sent');
    expect(items).toHaveLength(1);
    expect(items[0].failedSend?.kind).toBe('follow_up');
  });
});

describe('filterItems', () => {
  it('matches every term against name, country, language, subject and status', async () => {
    const items = await loadReviewItems(await seeded(), context);

    expect(filterItems(items, '').length).toBe(3);
    expect(filterItems(items, 'acme').map((item) => item.company.name)).toEqual(['Acme Robotics']);
    expect(filterItems(items, 'de en').map((item) => item.company.name)).toEqual(['Beta Labs']);
    expect(filterItems(items, 'fleet').length).toBe(3);
    expect(filterItems(items, 'approved').map((item) => item.company.name)).toEqual(['Gamma']);
    expect(filterItems(items, 'nothing like this')).toEqual([]);
  });

  it('filters on the generic flag and on fit', async () => {
    const items = await loadReviewItems(await seeded(), context);

    expect(filterItems(items, 'generic').map((item) => item.company.name)).toEqual(['Beta Labs']);
    expect(filterItems(items, 'tailored').length).toBe(2);
    expect(filterItems(items, 'fit>=4').length).toBe(3);
    expect(filterItems(items, 'fit>4')).toEqual([]);
  });
});

describe('buildPipeline', () => {
  const sent = (id: string, when: string): SendRecord => ({
    id,
    draftId: 'd',
    companyId: 'c',
    kind: 'initial',
    status: 'sent',
    scheduledAt: new Date(when),
    sentAt: new Date(when),
    providerMessageId: null,
    providerThreadId: null,
    error: null,
    updatedAt: new Date(when),
  });

  it('counts failed sends so they are visible in the strip', async () => {
    const store = await seeded();
    const failed: SendRecord = { ...sent('f', '2026-10-12T07:00:00Z'), status: 'failed', sentAt: null };

    const pipeline = buildPipeline(await store.listCompanies(), [failed], context.config, new Date('2026-10-12T09:00:00Z'));

    expect(pipeline.failedSends).toBe(1);
    expect(pipeline.sentToday).toBe(0);
  });

  it('counts companies per status and sends made today in the mailbox owner day against the cap', async () => {
    const store = await seeded();
    const now = new Date('2026-10-12T09:00:00Z');
    const sends = [
      sent('1', '2026-10-12T07:00:00Z'),
      sent('2', '2026-10-12T08:00:00Z'),
      sent('3', '2026-10-11T08:00:00Z'),
    ];

    const pipeline = buildPipeline(await store.listCompanies(), sends, context.config, now);

    expect(pipeline.counts).toEqual([
      { status: 'awaiting_review', count: 2 },
      { status: 'approved', count: 1 },
    ]);
    expect(pipeline.sentToday).toBe(2);
    // The first send was 1 day ago, so the first-week cap applies.
    expect(pipeline.dailyCap).toBe(20);
  });
});

describe('detail lines', () => {
  it('wraps words to the width and keeps blank lines', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('a\n\nb', 20)).toEqual(['a', '', 'b']);
  });

  it('splits a word longer than the width instead of overflowing', () => {
    expect(wrapText('x'.repeat(20), 8).every((line) => line.length <= 8)).toBe(true);
  });

  it('shows subject, body, follow-up, the hook text with its source URL, and the checks', async () => {
    const [item] = await loadReviewItems(await seeded(), context);

    const text = buildDetailLines(item, 80)
      .map((line) => line.text)
      .join('\n');

    expect(text).toContain('Your fleet scheduler');
    expect(text).toContain('short call this week?');
    expect(text).toContain('FOLLOW-UP');
    expect(text).toContain('Acme open-sources its fleet scheduler');
    expect(text).toContain('https://acme.example/blog');
    expect(text).toContain('email checks pass');
  });

  it('lists critic failures as warnings', async () => {
    const store = await seeded();
    store.drafts[0].subject = 'Great news!';
    const [item] = await loadReviewItems(store, context);

    const lines = buildDetailLines(item, 80);

    expect(lines.some((line) => line.tone === 'warn' && line.text.includes('subject_exclamation'))).toBe(true);
  });
});

const VERIFIER_REASON = 'blind verifier: 1 sentence(s) without a supporting source: "Acme raised a Series B." (unsupported)';

const BARE_COMPANY = {
  runId: 'run-1',
  slug: 'defunct-example',
  name: 'Defunct Co',
  domain: 'defunct.example',
  domainKey: 'defunct.example',
  website: null,
  contact: { email: 'a@defunct.example', name: null, role: null, roleAccount: false, mxStatus: 'ok' as const },
};

async function withNeedsManual(): Promise<{ store: InMemoryOutreachStore; companyId: string }> {
  const store = await seeded();
  const { company } = await seedDraft(store, 'flagged.example', { name: 'Flagged Co' });
  await store.updateCompany(company.id, { status: 'needs_manual', statusReason: VERIFIER_REASON });
  return { store, companyId: company.id };
}

async function withoutDraft(): Promise<InMemoryOutreachStore> {
  const store = new InMemoryOutreachStore();
  const company = await store.insertCompany(BARE_COMPANY);
  await store.updateCompany(company.id, { status: 'needs_manual', statusReason: 'the site looks defunct' });
  return store;
}

describe('needs_manual companies in the review list', () => {
  it('lists a company the verifier flagged, with its reason and its draft', async () => {
    const { store } = await withNeedsManual();

    const items = await loadReviewItems(store, context);
    const flagged = items.find((item) => item.company.name === 'Flagged Co');

    expect(flagged?.company.status).toBe('needs_manual');
    expect(flagged?.manualReason).toBe(VERIFIER_REASON);
    expect(flagged?.draft?.subject).toBeTruthy();
    expect(items.find((item) => item.company.name === 'Acme Robotics')?.manualReason).toBeNull();
  });

  it('lists a company that has no draft (the research stopped) with the research reason', async () => {
    const [item] = await loadReviewItems(await withoutDraft(), context);

    expect(item.draft).toBeNull();
    expect(item.manualReason).toBe('the site looks defunct');
    expect(item.failures).toEqual([]);
  });

  it('can be found by status and by the lowconf filter', async () => {
    const { store, companyId } = await withNeedsManual();
    const contact = store.contacts.get(companyId);
    if (!contact) throw new Error('seed failed');
    Object.assign(contact, { emailSource: 'pattern_guess', contactConfidence: 'low' });

    const items = await loadReviewItems(store, context);

    expect(filterItems(items, 'needs_manual').map((item) => item.company.name)).toEqual(['Flagged Co']);
    expect(filterItems(items, 'lowconf').map((item) => item.company.name)).toEqual(['Flagged Co']);
    expect(filterItems(items, 'generic').map((item) => item.company.name)).toEqual(['Beta Labs']);
  });
});

describe('sourced contacts with low confidence', () => {
  it('notes a guessed address and states how it was found', async () => {
    const store = await seeded();
    Object.assign([...store.contacts.values()][0], { emailSource: 'pattern_guess', contactConfidence: 'low' });

    const [item] = await loadReviewItems(store, context);

    expect(item.notes.join(' ')).toMatch(/Low-confidence contact \(pattern_guess\)/);
  });

  it('adds no note for a normal-confidence or listed address', async () => {
    const store = await seeded();
    Object.assign([...store.contacts.values()][0], { emailSource: 'page_quote', contactConfidence: 'normal' });

    const items = await loadReviewItems(store, context);

    expect(items[0].notes.join(' ')).not.toMatch(/Low-confidence/);
    expect(items[1].notes.join(' ')).not.toMatch(/Low-confidence/);
  });
});

describe('detail lines for decisions the owner has to take', () => {
  const textOf = (lines: ReturnType<typeof buildDetailLines>): string => lines.map((line) => line.text).join('\n');

  it('puts the reason and the available actions first for a needs_manual draft', async () => {
    const { store } = await withNeedsManual();
    const flagged = (await loadReviewItems(store, context)).find((item) => item.company.name === 'Flagged Co');
    if (!flagged) throw new Error('seed failed');

    const lines = buildDetailLines(flagged, 90);
    const text = textOf(lines);

    expect(text).toContain('NEEDS YOUR DECISION');
    expect(text).toContain('Acme raised a Series B.');
    expect(text).toMatch(/e to edit/);
    expect(text).toMatch(/confirm/);
    expect(text.indexOf('NEEDS YOUR DECISION')).toBeLessThan(text.indexOf('SUBJECT'));
    expect(lines.find((line) => line.text.includes('Series B'))?.tone).toBe('warn');
  });

  it('says there is no draft when none was written and offers kill only', async () => {
    const [item] = await loadReviewItems(await withoutDraft(), context);

    const text = textOf(buildDetailLines(item, 80));

    expect(text).toContain('the site looks defunct');
    expect(text).toMatch(/No draft was written/);
    expect(text).toMatch(/k to kill/);
    expect(text).not.toContain('SUBJECT');
  });

  it('shows contact_confidence and the source next to the recipient for a low-confidence contact', async () => {
    const store = await seeded();
    Object.assign([...store.contacts.values()][0], { emailSource: 'hunter', contactConfidence: 'low' });
    const [item] = await loadReviewItems(store, context);

    expect(textOf(buildDetailLines(item, 100))).toMatch(/contact_confidence: low.*hunter|hunter.*contact_confidence: low/);
  });
});

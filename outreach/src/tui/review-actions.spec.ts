import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { seedDraft } from '../testing/seed';
import { loadExampleConfig, loadExampleInventory } from '../testing/test-env';

import { applyEdit, approveAll, approveDespite, approveItem, emailOf, killItem, retryFailedSend } from './review-actions';
import { loadReviewItems } from './review-items';

const context = { config: loadExampleConfig(), db: loadExampleInventory() };
const verified = async (): Promise<boolean> => true;

async function firstItem(store: InMemoryOutreachStore) {
  const [item] = await loadReviewItems(store, context);
  return item;
}

describe('approveItem', () => {
  it('approves a draft that passes its checks: draft and company both become approved', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');

    const result = await approveItem(store, await firstItem(store));

    expect(result.ok).toBe(true);
    expect(store.drafts[0].status).toBe('approved');
    expect([...store.companies.values()][0].status).toBe('approved');
  });

  it('refuses a draft that breaks a rule and tells the reviewer to edit it', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');
    store.drafts[0].subject = 'Great news!';

    const result = await approveItem(store, await firstItem(store));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/subject_exclamation/);
    expect(result.message).toMatch(/Fix it with e/);
    expect(store.drafts[0].status).toBe('awaiting_review');
  });

  it('refuses a draft that is already approved', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example', { decision: 'approved' });

    const result = await approveItem(store, await firstItem(store));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already approved/);
  });
});

describe('approveAll', () => {
  it('approves the awaiting drafts that pass and leaves the failing ones, reporting them', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'one.example');
    await seedDraft(store, 'two.example');
    await seedDraft(store, 'three.example', { decision: 'approved' });
    store.drafts[1].subject = 'Great news!';

    const result = await approveAll(store, await loadReviewItems(store, context), verified);

    expect(result.message).toMatch(/approved 1; 1 failed a check/);
    expect(store.drafts.map((draft) => draft.status)).toEqual(['approved', 'awaiting_review', 'approved']);
  });

  it('leaves drafts the blind verifier has not passed and reports how many', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'one.example');
    await seedDraft(store, 'two.example');

    const result = await approveAll(store, await loadReviewItems(store, context), async (item) => item.company.slug === 'one-example');

    expect(result.message).toMatch(/approved 1; 1 not verified yet \(approve individually\): Acme Robotics/);
    expect(store.drafts.map((draft) => draft.status)).toEqual(['approved', 'awaiting_review']);
  });

  it('leaves low-confidence contacts for an individual decision and reports how many', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'one.example');
    await seedDraft(store, 'two.example');
    Object.assign([...store.contacts.values()][1], { emailSource: 'pattern_guess', contactConfidence: 'low' });

    const result = await approveAll(store, await loadReviewItems(store, context), verified);

    expect(result.message).toMatch(/approved 1; 1 low-confidence contact \(approve individually\): Acme Robotics/);
    expect(store.drafts.map((draft) => draft.status)).toEqual(['approved', 'awaiting_review']);
  });

  it('reports every reason when drafts are left for several reasons', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'one.example');
    await seedDraft(store, 'two.example');
    await seedDraft(store, 'three.example');
    store.drafts[0].subject = 'Great news!';
    Object.assign([...store.contacts.values()][1], { emailSource: 'hunter', contactConfidence: 'low' });

    const result = await approveAll(store, await loadReviewItems(store, context), async (item) => item.company.slug !== 'three-example');

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/approved 0; 1 failed a check.*1 not verified yet.*1 low-confidence/);
  });
});

describe('killItem', () => {
  it('kills the company and its draft, and cancels a send that is already scheduled', async () => {
    const store = new InMemoryOutreachStore();
    const { draft } = await seedDraft(store, 'acme.example', { decision: 'approved' });
    await store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: new Date() });

    const result = await killItem(store, await firstItem(store));

    expect(result.ok).toBe(true);
    expect([...store.companies.values()][0].status).toBe('killed');
    expect(store.drafts[0].status).toBe('killed');
    expect(store.sends[0].status).toBe('cancelled');
  });
});

describe('applyEdit', () => {
  it('stores a valid edit as a new draft version awaiting review, keeping the resume and hook', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');
    const item = await firstItem(store);
    const edited = { ...emailOf(item), body: emailOf(item).body.replace('Hi Claire,', 'Hello Claire,') };

    const result = await applyEdit(store, item, edited, context);

    expect(result).toMatchObject({ ok: true, changed: true });
    const [old, latest] = store.drafts;
    expect(old.status).toBe('superseded');
    expect(latest).toMatchObject({ version: 2, status: 'awaiting_review', resumePdfPath: store.drafts[0].resumePdfPath, hookClaimId: 'c1' });
    expect(latest.body).toContain('Hello Claire,');
  });

  it('re-runs the critic and stores nothing when the edit breaks a rule', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');
    const item = await firstItem(store);

    const result = await applyEdit(store, item, { ...emailOf(item), subject: 'Amazing opportunity!' }, context);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failures.join(' ')).toMatch(/subject_exclamation/);
    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0].status).toBe('awaiting_review');
  });

  it('rejects an edit that removes the call to action from the body', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');
    const item = await firstItem(store);
    const body = emailOf(item).body.replace(store.drafts[0].cta, 'Let me know.');

    const result = await applyEdit(store, item, { ...emailOf(item), body }, context);

    expect(!result.ok && result.failures.join(' ')).toMatch(/call_to_action/);
    expect(store.drafts).toHaveLength(1);
  });

  it('does nothing when the text is unchanged', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');
    const item = await firstItem(store);

    expect(await applyEdit(store, item, emailOf(item), context)).toMatchObject({ ok: true, changed: false });
    expect(store.drafts).toHaveLength(1);
  });

  it('refuses to edit a draft that is already approved', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example', { decision: 'approved' });
    const item = await firstItem(store);

    const result = await applyEdit(store, item, { ...emailOf(item), subject: 'Another subject' }, context);

    expect(result.ok).toBe(false);
    expect(store.drafts).toHaveLength(1);
  });
});

describe('follow-up claim', () => {
  it('flags a draft whose follow-up cites a claim that is not verified, so it cannot be approved', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example', { followUpClaimId: 'c9' });
    const item = await firstItem(store);

    expect(item.failures.map((failure) => failure.rule)).toContain('follow_up_claim');
    expect((await approveItem(store, item)).ok).toBe(false);
  });

  it('keeps the follow-up claim through an edit, and still checks it', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example', { followUpClaimId: 'c1' });
    const item = await firstItem(store);
    expect(item.failures).toEqual([]);

    const result = await applyEdit(store, item, { ...emailOf(item), subject: 'Your fleet scheduler, briefly' }, context);

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(store.drafts[1].followUpClaimId).toBe('c1');
  });

  it('rejects an edit of a draft whose follow-up cites an unverified claim', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example', { followUpClaimId: 'c9' });
    const item = await firstItem(store);

    const result = await applyEdit(store, item, { ...emailOf(item), subject: 'Another subject line' }, context);

    expect(!result.ok && result.failures.join(' ')).toMatch(/follow_up_claim/);
    expect(store.drafts).toHaveLength(1);
  });
});

describe('retryFailedSend', () => {
  const now = new Date('2026-10-12T06:29:00Z');

  async function failedInitial(store: InMemoryOutreachStore): Promise<string> {
    const { draft, company } = await seedDraft(store, 'acme.example', { decision: 'approved' });
    const row = await store.createSend({ draftId: draft.id, kind: 'initial', scheduledAt: new Date(now.getTime() - 3_600_000) });
    await store.claimSend(row?.id as string);
    await store.updateSend(row?.id as string, { status: 'failed', error: 'Gmail API 400: Invalid To header' });
    await store.updateCompany(company.id, { statusReason: 'initial send failed: Gmail API 400: Invalid To header' });
    return row?.id as string;
  }

  it('shows a failed send in the list with the reason, so it is not lost', async () => {
    const store = new InMemoryOutreachStore();
    await failedInitial(store);

    const item = await firstItem(store);

    expect(item.failedSend?.status).toBe('failed');
    expect(item.notes.join(' ')).toMatch(/Send failed.*Invalid To header.*r to retry/);
  });

  it('resets the same send row to scheduled in a fresh slot and clears the reason', async () => {
    const store = new InMemoryOutreachStore();
    const rowId = await failedInitial(store);

    const result = await retryFailedSend(store, await firstItem(store), { ...context, now: () => now, random: () => 0 });

    expect(result.ok).toBe(true);
    expect(store.sends).toHaveLength(1);
    const row = store.sends[0];
    expect(row).toMatchObject({ id: rowId, status: 'scheduled', error: null });
    expect(row.scheduledAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect([...store.companies.values()][0].statusReason).toBeNull();
  });

  it('requeues only when the row is still failed: a send another process already moved is left alone', async () => {
    const store = new InMemoryOutreachStore();
    const rowId = await failedInitial(store);
    const stale = await firstItem(store);
    const movedOn = new Date(now.getTime() + 600_000);
    await store.updateSend(rowId, { status: 'scheduled', scheduledAt: movedOn, error: null });

    const result = await retryFailedSend(store, stale, { ...context, now: () => now, random: () => 0 });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no longer failed/);
    expect(store.sends[0].scheduledAt).toEqual(movedOn);
    expect([...store.companies.values()][0].statusReason).toMatch(/initial send failed/);
  });

  it('lets exactly one of two simultaneous retries through', async () => {
    const store = new InMemoryOutreachStore();
    await failedInitial(store);
    const item = await firstItem(store);

    const results = await Promise.all([
      retryFailedSend(store, item, { ...context, now: () => now, random: () => 0 }),
      retryFailedSend(store, item, { ...context, now: () => now, random: () => 0 }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(store.events.filter((event) => event.type === 'send.retry_requested')).toHaveLength(1);
  });

  it('refuses an item with no failed send', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');

    const result = await retryFailedSend(store, await firstItem(store), { ...context, now: () => now });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no failed send/);
  });

  it('refuses when the company has moved on since the failure', async () => {
    const store = new InMemoryOutreachStore();
    await failedInitial(store);
    const item = await firstItem(store);
    await store.updateCompany(item.company.id, { status: 'killed' });

    const result = await retryFailedSend(store, { ...item, company: { ...item.company, status: 'killed' } }, { ...context, now: () => now });

    expect(result.ok).toBe(false);
    expect(store.sends[0].status).toBe('failed');
  });
});

const BARE_COMPANY = {
  runId: 'run-1',
  slug: 'defunct-example',
  name: 'Defunct Co',
  domain: 'defunct.example',
  domainKey: 'defunct.example',
  website: null,
  contact: { email: 'a@defunct.example', name: null, role: null, roleAccount: false, mxStatus: 'ok' as const },
};

async function flaggedStore(reason = 'blind verifier: 1 sentence(s) without a supporting source'): Promise<InMemoryOutreachStore> {
  const store = new InMemoryOutreachStore();
  const { company } = await seedDraft(store, 'acme.example');
  await store.updateCompany(company.id, { status: 'needs_manual', statusReason: reason });
  return store;
}

async function storeWithoutDraft(): Promise<{ store: InMemoryOutreachStore; companyId: string }> {
  const store = new InMemoryOutreachStore();
  const company = await store.insertCompany(BARE_COMPANY);
  await store.updateCompany(company.id, { status: 'needs_manual', statusReason: 'looks defunct' });
  return { store, companyId: company.id };
}

describe('needs_manual companies', () => {
  it('are not approved by a plain approve, which points to the two ways forward', async () => {
    const store = await flaggedStore();

    const result = await approveItem(store, await firstItem(store));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/needs_manual/);
    expect(result.message).toMatch(/e to edit/);
    expect(store.drafts[0].status).toBe('awaiting_review');
  });

  it('are skipped by approve all', async () => {
    const store = await flaggedStore();
    await seedDraft(store, 'fine.example');

    const result = await approveAll(store, await loadReviewItems(store, context), verified);

    expect(result.message).toBe('approved 1');
    expect([...store.companies.values()].map((company) => company.status).sort()).toEqual(['approved', 'needs_manual']);
  });

  it('can be approved despite the reasons, which are recorded', async () => {
    const store = await flaggedStore();

    const result = await approveDespite(store, await firstItem(store));

    expect(result.ok).toBe(true);
    expect(store.drafts[0].status).toBe('approved');
    expect([...store.companies.values()][0].status).toBe('approved');
    expect(store.events.find((event) => event.type === 'draft.approved_despite')?.payload).toMatchObject({
      reason: expect.stringContaining('blind verifier'),
    });
  });

  it('are not approved despite the reasons when the draft also breaks an email rule', async () => {
    const store = await flaggedStore();
    store.drafts[0].subject = 'Great news!';

    const result = await approveDespite(store, await firstItem(store));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/subject_exclamation/);
    expect([...store.companies.values()][0].status).toBe('needs_manual');
  });

  it('refuse approve despite for a company that is not needs_manual', async () => {
    const store = new InMemoryOutreachStore();
    await seedDraft(store, 'acme.example');

    const result = await approveDespite(store, await firstItem(store));

    expect(result.ok).toBe(false);
    expect(store.drafts[0].status).toBe('awaiting_review');
  });

  it('refuse approve despite when there is no draft', async () => {
    const { store } = await storeWithoutDraft();

    const result = await approveDespite(store, await firstItem(store));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no draft/i);
  });

  it('can be killed with a draft', async () => {
    const store = await flaggedStore();

    expect((await killItem(store, await firstItem(store))).ok).toBe(true);

    expect([...store.companies.values()][0].status).toBe('killed');
    expect(store.drafts[0].status).toBe('killed');
  });

  it('can be killed without a draft', async () => {
    const { store, companyId } = await storeWithoutDraft();

    expect((await killItem(store, await firstItem(store))).ok).toBe(true);

    expect((await store.getCompany(companyId))?.status).toBe('killed');
    expect(store.events.some((event) => event.type === 'company.killed' && event.companyId === companyId)).toBe(true);
  });

  it('go back to awaiting review after a successful edit, where a plain approve works', async () => {
    const store = await flaggedStore();
    const item = await firstItem(store);

    const result = await applyEdit(store, item, { ...emailOf(item), subject: 'About your fleet scheduler' }, context);

    expect(result.ok).toBe(true);
    const company = [...store.companies.values()][0];
    expect(company.status).toBe('awaiting_review');
    expect(company.statusReason).toBeNull();
    expect((await approveItem(store, await firstItem(store))).ok).toBe(true);
  });

  it('stay needs_manual when the edit fails the email checks', async () => {
    const store = await flaggedStore();
    const item = await firstItem(store);

    const result = await applyEdit(store, item, { ...emailOf(item), subject: 'Great news!' }, context);

    expect(result.ok).toBe(false);
    expect([...store.companies.values()][0].status).toBe('needs_manual');
  });

  it('cannot be edited when there is no draft', async () => {
    const { store } = await storeWithoutDraft();

    const result = await applyEdit(store, await firstItem(store), { subject: 'x', body: 'y', followUpBody: 'z' }, context);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no draft/i);
  });
});

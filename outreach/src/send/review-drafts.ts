import type { CompanyRecord, ContactRecord, DraftRecord, OutreachStore } from '../db/outreach-store';

/** A draft the owner can still look at or send: awaiting review or approved, with its company and contact. */
export interface ReviewableDraft {
  company: CompanyRecord;
  contact: ContactRecord;
  draft: DraftRecord;
}

/**
 * The latest draft of every company in the run that is awaiting review or approved, by slug. `slug` narrows it to
 * one company and fails loudly when that company has nothing to show, so a typo is not mistaken for "no drafts".
 */
export async function listReviewableDrafts(store: OutreachStore, runId: string, slug?: string): Promise<{ items: ReviewableDraft[] }> {
  const items: ReviewableDraft[] = [];
  for (const draft of await store.listLatestDrafts(runId)) {
    if (draft.status !== 'awaiting_review' && draft.status !== 'approved') continue;
    const company = await store.getCompany(draft.companyId);
    const contact = company ? await store.getContact(company.id) : null;
    if (!company || !contact) continue;
    if (slug !== undefined && company.slug !== slug) continue;
    items.push({ company, contact, draft });
  }
  items.sort((a, b) => a.company.slug.localeCompare(b.company.slug));
  if (slug !== undefined && items.length === 0) {
    throw new Error(`No draft awaiting review or approved for "${slug}" in run ${runId}`);
  }
  return { items };
}

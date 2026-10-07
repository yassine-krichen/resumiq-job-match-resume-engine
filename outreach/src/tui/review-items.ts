import { DateTime } from 'luxon';

import type { AppConfig } from '../config/app-config';
import { critiqueDraft } from '../core/critic';
import type { CriticFailure } from '../core/critic';
import { DEFAULT_CAP_ZONE } from '../core/send-scheduler';
import { COMPANY_STATUSES } from '../db/outreach-store';
import type {
  CompanyRecord,
  CompanyStatus,
  ContactRecord,
  DossierRecord,
  DraftRecord,
  OutreachStore,
  SendRecord,
} from '../db/outreach-store';
import type { MasterDB } from '../resume/master-db';
import type { OutreachClaim, OutreachDraft, OutreachLanguage } from '../schemas/outreach';
import { effectiveDailyCap } from '../send/daily-cap';

// The data behind the review screen. Pure functions over what the store returned, so the screen itself
// has nothing to decide.

/**
 * What the list shows: drafts waiting for a decision, the decisions already taken but not yet sent, and the
 * companies a stage handed to the owner (`needs_manual`: the verifier flagged a sentence, or the research stopped).
 */
export const REVIEW_STATUSES: readonly CompanyStatus[] = ['awaiting_review', 'approved', 'scheduled', 'needs_manual'];

export interface ReviewItem {
  company: CompanyRecord;
  contact: ContactRecord | null;
  /** Null for a `needs_manual` company whose research stopped before a draft was written. */
  draft: DraftRecord | null;
  dossier: DossierRecord | null;
  /** Why a `needs_manual` company needs the owner (verifier sentences, research reason); null for every other status. */
  manualReason: string | null;
  /** A send of this company that Gmail rejected or that could not be built; it waits for `r`, never retried alone. */
  failedSend: SendRecord | null;
  /** Rules the draft breaks right now (the same critic that ran when it was written). Block approval. */
  failures: CriticFailure[];
  /** Things worth a second look that are not rule failures. */
  notes: string[];
}

export interface ReviewContext {
  config: AppConfig;
  db: MasterDB;
}

export function toCriticDraft(draft: DraftRecord): OutreachDraft {
  return {
    subject: draft.subject,
    body: draft.body,
    follow_up_body: draft.followUpBody,
    cta: draft.cta,
    hook_claim_id: draft.hookClaimId,
    follow_up_claim_id: draft.followUpClaimId ?? null,
    anchor_phrase: draft.anchorPhrase,
    mentioned_projects: draft.mentionedProjects,
    generic: draft.generic,
  };
}

/** Runs the critic on a draft the way the draft stage does. Without a dossier the language and timezone are unknown. */
export function critiqueStoredDraft(
  draft: OutreachDraft,
  language: OutreachLanguage,
  company: CompanyRecord,
  dossier: DossierRecord | null,
  context: ReviewContext,
): CriticFailure[] {
  if (!dossier) return [{ rule: 'hook', detail: 'no dossier is stored for this company, so the draft cannot be checked' }];
  return critiqueDraft({
    draft,
    language,
    companyName: company.name,
    timezone: dossier.data.timezone,
    config: context.config.outreach,
    verifiedClaims: dossier.data.claims,
    masterDb: context.db,
  }).failures;
}

function notesFor(draft: DraftRecord | null, contact: ContactRecord | null, failedSend: SendRecord | null): string[] {
  const notes: string[] = [];
  if (failedSend) {
    const which = failedSend.kind === 'initial' ? 'first email' : 'follow-up';
    notes.push(`Send failed (${which}): ${failedSend.error ?? 'unknown reason'}. Press r to retry.`);
  }
  if (draft?.generic) notes.push('Generic draft: no verified hook, sent with the track resume.');
  if (draft?.resumeKind === 'track') notes.push(`Track resume (${draft.track ?? 'unknown'}), not tailored.`);
  if (contact === null) notes.push('No contact is stored for this company.');
  else {
    if (contact.roleAccount) notes.push('Role address (info@, jobs@...): a person may never read it.');
    if (contact.mxStatus === 'none') notes.push('The domain has no MX record: this will likely bounce.');
    if (contact.mxStatus === 'unknown') notes.push('The MX check was inconclusive.');
    if (isLowConfidence(contact)) {
      notes.push(`Low-confidence contact (${contact.emailSource ?? 'unknown source'}): the address was guessed or scored low; check it before approving.`);
    }
  }
  return notes;
}

export function isLowConfidence(contact: ContactRecord | null): boolean {
  return contact?.contactConfidence === 'low';
}

export async function loadReviewItems(store: OutreachStore, context: ReviewContext): Promise<ReviewItem[]> {
  const [allCompanies, failedSends] = await Promise.all([store.listCompanies(), store.listSends({ statuses: ['failed'] })]);
  const failedByCompany = new Map(failedSends.map((send) => [send.companyId, send]));
  // A failed send stays visible whatever the company status is (a failed follow-up leaves it `sent`).
  const companies = allCompanies.filter(
    (company) => REVIEW_STATUSES.includes(company.status) || failedByCompany.has(company.id),
  );
  const items = await Promise.all(
    companies.map(async (company): Promise<ReviewItem | null> => {
      const [draft, contact, dossier] = await Promise.all([
        store.getLatestDraft(company.id),
        store.getContact(company.id),
        store.getLatestDossier(company.id),
      ]);
      // Only a company waiting on the owner can be listed without a draft (there is nothing else to review).
      if (!draft && company.status !== 'needs_manual') return null;
      const failedSend = failedByCompany.get(company.id) ?? null;
      return {
        company,
        contact,
        draft,
        dossier,
        manualReason: company.status === 'needs_manual' ? (company.statusReason ?? 'no reason was recorded') : null,
        failedSend,
        failures: draft ? critiqueStoredDraft(toCriticDraft(draft), draft.language, company, dossier, context) : [],
        notes: notesFor(draft, contact, failedSend),
      };
    }),
  );
  return items.filter((item): item is ReviewItem => item !== null);
}

export function hookClaim(item: ReviewItem): OutreachClaim | null {
  const hookClaimId = item.draft?.hookClaimId ?? null;
  if (!item.dossier || hookClaimId === null) return null;
  return item.dossier.data.claims.find((claim) => claim.id === hookClaimId) ?? null;
}

export function fitScore(item: ReviewItem): number | null {
  return item.dossier?.data.fit.score ?? null;
}

export function countryOf(item: ReviewItem): string {
  return item.dossier?.data.country ?? '--';
}

// ── Filter ──────────────────────────────────────────────────────────────────

/**
 * Every space-separated term must match (case-insensitive) the company name, slug, country, language, subject,
 * track or status. The words `generic` and `tailored` filter on that flag, `lowconf` on a guessed or low-scored sourced address; `fit>=4` / `fit<3` filter on the score.
 */
export function filterItems(items: readonly ReviewItem[], query: string): ReviewItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];
  return items.filter((item) => terms.every((term) => matchesTerm(item, term)));
}

function matchesTerm(item: ReviewItem, term: string): boolean {
  if (term === 'generic') return item.draft?.generic === true;
  if (term === 'tailored') return item.draft !== null && !item.draft.generic;
  if (term === 'lowconf') return isLowConfidence(item.contact);
  const fit = term.match(/^fit(>=|<=|=|>|<)(\d)$/);
  if (fit) return compareFit(fitScore(item), fit[1], Number(fit[2]));
  const haystack = [
    item.company.name,
    item.company.slug,
    countryOf(item),
    item.draft?.language ?? item.dossier?.data.language ?? '',
    item.draft?.subject ?? '',
    item.draft?.track ?? '',
    item.company.status,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

function compareFit(score: number | null, operator: string, value: number): boolean {
  if (score === null) return false;
  switch (operator) {
    case '>=':
      return score >= value;
    case '<=':
      return score <= value;
    case '>':
      return score > value;
    case '<':
      return score < value;
    default:
      return score === value;
  }
}

// ── Pipeline strip ──────────────────────────────────────────────────────────

export interface PipelineSummary {
  /** Statuses with at least one company, in pipeline order. */
  counts: Array<{ status: CompanyStatus; count: number }>;
  sentToday: number;
  dailyCap: number;
  /** Sends waiting for a human decision (`r`). */
  failedSends: number;
}

export function buildPipeline(
  companies: readonly CompanyRecord[],
  sends: readonly SendRecord[],
  config: AppConfig,
  now: Date,
): PipelineSummary {
  const counts = COMPANY_STATUSES.map((status) => ({
    status,
    count: companies.filter((company) => company.status === status).length,
  })).filter((entry) => entry.count > 0);

  // The cap's "day" is the mailbox owner's, as in the scheduler.
  const today = DateTime.fromJSDate(now, { zone: DEFAULT_CAP_ZONE });
  const sentRows = sends.filter((send) => send.status === 'sent' && send.sentAt !== null);
  const sentToday = sentRows.filter((send) => DateTime.fromJSDate(send.sentAt as Date, { zone: DEFAULT_CAP_ZONE }).hasSame(today, 'day')).length;
  const firstSent = sentRows.map((send) => (send.sentAt as Date).getTime());

  return {
    counts,
    sentToday,
    failedSends: sends.filter((send) => send.status === 'failed').length,
    dailyCap: effectiveDailyCap({
      now,
      firstSentAt: firstSent.length > 0 ? new Date(Math.min(...firstSent)) : null,
      hadBounce: companies.some((company) => company.status === 'bounced'),
      week1Cap: config.outreach.daily_cap_week1,
      cap: config.outreach.daily_cap,
    }),
  };
}

export async function loadPipeline(store: OutreachStore, config: AppConfig, now: Date): Promise<PipelineSummary> {
  const [companies, sends] = await Promise.all([store.listCompanies(), store.listSends()]);
  return buildPipeline(companies, sends, config, now);
}

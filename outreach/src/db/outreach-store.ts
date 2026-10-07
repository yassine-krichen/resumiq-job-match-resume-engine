import type {
  ContactConfidence,
  EmailSource,
  OutreachClaim,
  OutreachDossier,
  OutreachLanguage,
  OutreachTailoring,
  OutreachTrack,
} from '../schemas/outreach';

// The services depend on this interface, not on Prisma, so every stage can be
// tested against the in-memory store in src/testing. Each multi-step method
// (storeDossier, storeDraft) is one atomic unit: the Prisma store runs it in a
// transaction, which is what keeps a crash from leaving a draft without its
// status change.

export const COMPANY_STATUSES = [
  'ingested',
  'dossier_ready',
  'awaiting_review',
  'needs_manual',
  'dropped',
  'failed',
  'approved',
  'scheduled',
  'sent',
  'replied',
  'bounced',
  'killed',
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export type MxState = 'ok' | 'none' | 'unknown' | 'unchecked';
export type ResumeKind = 'tailored' | 'track';
export type DraftStatus = 'awaiting_review' | 'approved' | 'killed' | 'superseded';

export interface CompanyRecord {
  id: string;
  runId: string;
  slug: string;
  name: string;
  domain: string | null;
  domainKey: string;
  website: string | null;
  status: CompanyStatus;
  statusReason: string | null;
  draftAttempts: number;
  track: OutreachTrack | null;
  /** Last change to the company row (a status move); `prune` measures a lead's age from it. */
  updatedAt: Date;
}

export interface ContactRecord {
  companyId: string;
  email: string;
  name: string | null;
  role: string | null;
  roleAccount: boolean;
  mxStatus: MxState;
  /** How a sourced address was found; absent for addresses that came from a list. */
  emailSource?: EmailSource | null;
  /** `low` for a guessed or low-scored sourced address; the review screen flags it. */
  contactConfidence?: ContactConfidence | null;
}

export interface NewCompany {
  runId: string;
  slug: string;
  name: string;
  domain: string | null;
  domainKey: string;
  website: string | null;
  contact: Omit<ContactRecord, 'companyId'>;
}

export interface DossierRecord {
  companyId: string;
  version: number;
  /** The dossier with only the quote-verified claims. */
  data: OutreachDossier;
  rejectedClaims: Array<{ claim: OutreachClaim; reason: string }>;
  verifiedClaimCount: number;
}

export interface NewDraft {
  generic: boolean;
  language: OutreachLanguage;
  subject: string;
  body: string;
  followUpBody: string;
  cta: string;
  hookClaimId: string | null;
  /** Verified claim the follow-up rests on, when it states a fact about the company. */
  followUpClaimId?: string | null;
  anchorPhrase: string | null;
  mentionedProjects: string[];
  tailoring: OutreachTailoring | null;
  resumeKind: ResumeKind;
  track: OutreachTrack | null;
  /** Relative to the outreach/ folder. */
  resumePdfPath: string;
}

export interface DraftRecord extends NewDraft {
  id: string;
  companyId: string;
  version: number;
  status: DraftStatus;
}

export interface SuppressionList {
  emails: string[];
  domains: string[];
}

export interface CompanyFilter {
  runId?: string;
  statuses?: readonly CompanyStatus[];
}

export interface CompanyPatch {
  status?: CompanyStatus;
  statusReason?: string | null;
  draftAttempts?: number;
  track?: OutreachTrack | null;
}

export type SendKind = 'initial' | 'follow_up';
export type SendStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'unknown';

export interface SendRecord {
  id: string;
  draftId: string;
  companyId: string;
  kind: SendKind;
  status: SendStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  /** The RFC 5322 Message-ID ("<...@...>") of the message as the recipient got it; null until read back. */
  providerMessageId: string | null;
  providerThreadId: string | null;
  error: string | null;
  /** Last status change; a `sending` row older than 15 minutes is stuck and becomes `unknown`. */
  updatedAt: Date;
}

export interface SendPatch {
  status?: SendStatus;
  scheduledAt?: Date;
  providerMessageId?: string | null;
  error?: string | null;
}

export interface InboundOutcome {
  status: Extract<CompanyStatus, 'replied' | 'bounced'>;
  statusReason: string | null;
  /** Permanent opt-out: this address is never emailed again. */
  suppressEmail?: { email: string; reason: string };
}


/** Thrown by insertCompany when the domain key or slug is already taken (the unique constraint). */
export class DuplicateCompanyError extends Error {}

export interface OutreachStore {
  /** Every domain key already in the DB, across all runs. */
  listDomainKeys(): Promise<string[]>;
  listSuppressions(): Promise<SuppressionList>;
  insertCompany(input: NewCompany): Promise<CompanyRecord>;
  listCompanies(filter?: CompanyFilter): Promise<CompanyRecord[]>;
  getCompanyBySlug(slug: string): Promise<CompanyRecord | null>;
  getContact(companyId: string): Promise<ContactRecord | null>;
  updateCompany(companyId: string, patch: CompanyPatch): Promise<CompanyRecord>;
  /** Saves a new dossier version and moves the company to `status` in one step. */
  storeDossier(
    companyId: string,
    dossier: Omit<DossierRecord, 'companyId' | 'version'>,
    next: { status: CompanyStatus; statusReason: string | null; track: OutreachTrack },
  ): Promise<DossierRecord>;
  getLatestDossier(companyId: string): Promise<DossierRecord | null>;
  /**
   * Saves a new draft version (older drafts become `superseded`), resets the
   * attempt counter and moves the company to awaiting_review, in one step.
   */
  storeDraft(companyId: string, draft: NewDraft): Promise<DraftRecord>;
  getLatestDraft(companyId: string): Promise<DraftRecord | null>;
  listLatestDrafts(runId?: string): Promise<DraftRecord[]>;
  recordEvent(companyId: string | null, type: string, payload: Record<string, unknown>): Promise<void>;

  // ── Review and sending (SPEC sections 7 and 9) ──
  getCompany(companyId: string): Promise<CompanyRecord | null>;
  getDraft(draftId: string): Promise<DraftRecord | null>;
  /**
   * The reviewer's decision, in one step: the draft and its company become approved or killed.
   * A kill also cancels every send of that company that has not started yet.
   */
  reviewDraft(companyId: string, draftId: string, decision: 'approved' | 'killed'): Promise<void>;
  listSends(filter?: { statuses?: readonly SendStatus[] }): Promise<SendRecord[]>;
  /**
   * Inserts the send row. Returns null when the draft already has one of that kind (the unique
   * constraint is the no-double-send guard). An initial send also moves the company to `scheduled`.
   */
  createSend(input: { draftId: string; kind: SendKind; scheduledAt: Date }): Promise<SendRecord | null>;
  /** Compare-and-set `scheduled` -> `sending`; false when another process got there first or it is no longer scheduled. */
  claimSend(sendId: string): Promise<boolean>;
  /** `sending` -> `sent`; an initial send also moves the company to `sent`. */
  completeSend(
    sendId: string,
    result: { sentAt: Date; providerMessageId: string | null; providerThreadId: string; error?: string | null },
  ): Promise<void>;
  updateSend(sendId: string, patch: SendPatch): Promise<SendRecord>;
  /**
   * Compare-and-set `failed` -> `scheduled` at `scheduledAt`, clearing the error. False when the row is no longer
   * failed (another process requeued it, or the tick already moved it), so a stale screen cannot overwrite it.
   */
  requeueFailedSend(sendId: string, scheduledAt: Date): Promise<boolean>;
  /**
   * A reply or bounce, in one step: the company's new status, every unsent send of it cancelled and,
   * for an opt-out, the suppression row. A crash cannot leave a replied company still scheduled to send.
   */
  recordInbound(companyId: string, outcome: InboundOutcome): Promise<void>;
  /**
   * Takes the named lease for `ttlMs` unless another holder has an unexpired one (one conditional upsert, so two
   * processes cannot both win). An expired lease, left by a crashed tick, is taken over. The expiry is judged by
   * the database clock.
   */
  acquireLease(name: string, holder: string, ttlMs: number): Promise<boolean>;
  /** Extends the lease to now + `ttlMs`; false when `holder` no longer owns it (expired and taken over). */
  renewLease(name: string, holder: string, ttlMs: number): Promise<boolean>;
  releaseLease(name: string, holder: string): Promise<void>;

  // ── Retention (SPEC section 11, phase 4) ──
  /**
   * Erases what identifies a lead, in one step: its contacts and dossiers are deleted and every draft keeps
   * only its status and version (subject, bodies, claims, tailoring and resume path are blanked). The company
   * row stays with its domain key and status, so dedupe still recognises it, and sends stay as a record.
   * A company without a contact has been pruned already.
   */
  pruneCompanyData(companyId: string): Promise<void>;
}

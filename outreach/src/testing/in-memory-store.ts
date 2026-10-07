import { DuplicateCompanyError } from '../db/outreach-store';
import type {
  CompanyFilter,
  CompanyPatch,
  CompanyRecord,
  CompanyStatus,
  ContactRecord,
  DossierRecord,
  DraftRecord,
  InboundOutcome,
  NewCompany,
  NewDraft,
  OutreachStore,
  SendKind,
  SendPatch,
  SendRecord,
  SendStatus,
  SuppressionList,
} from '../db/outreach-store';
import type { OutreachTrack } from '../schemas/outreach';

/**
 * Test double for OutreachStore. It enforces the same invariants as the
 * database (unique domain key and slug, versioned dossiers and drafts, a
 * superseded older draft) so service tests exercise real behaviour.
 */
export class InMemoryOutreachStore implements OutreachStore {
  readonly companies = new Map<string, CompanyRecord>();
  readonly contacts = new Map<string, ContactRecord>();
  readonly dossiers: DossierRecord[] = [];
  readonly drafts: DraftRecord[] = [];
  readonly events: Array<{ companyId: string | null; type: string; payload: Record<string, unknown> }> = [];
  readonly sends: SendRecord[] = [];
  suppressions: SuppressionList = { emails: [], domains: [] };
  /** Leases by name; tests write here to simulate another holder or an expiry. */
  readonly leases = new Map<string, { holder: string; expiresAt: number }>();
  /** Tests move this to control `updatedAt` stamps. */
  clock: () => Date = () => new Date();
  private nextId = 1;

  async listDomainKeys(): Promise<string[]> {
    return [...this.companies.values()].map((company) => company.domainKey);
  }

  async listSuppressions(): Promise<SuppressionList> {
    return this.suppressions;
  }

  async insertCompany(input: NewCompany): Promise<CompanyRecord> {
    const taken = [...this.companies.values()].some(
      (company) => company.domainKey === input.domainKey || company.slug === input.slug,
    );
    if (taken) throw new DuplicateCompanyError(`${input.domainKey} is already in the database`);
    const record: CompanyRecord = {
      id: `company-${this.nextId++}`,
      runId: input.runId,
      slug: input.slug,
      name: input.name,
      domain: input.domain,
      domainKey: input.domainKey,
      website: input.website,
      status: 'ingested',
      statusReason: null,
      draftAttempts: 0,
      track: null,
      updatedAt: this.clock(),
    };
    this.companies.set(record.id, record);
    this.contacts.set(record.id, { companyId: record.id, ...input.contact });
    return { ...record };
  }

  async listCompanies(filter: CompanyFilter = {}): Promise<CompanyRecord[]> {
    return [...this.companies.values()]
      .filter((company) => filter.runId === undefined || company.runId === filter.runId)
      .filter((company) => filter.statuses === undefined || filter.statuses.includes(company.status))
      .map((company) => ({ ...company }));
  }

  async getCompanyBySlug(slug: string): Promise<CompanyRecord | null> {
    const found = [...this.companies.values()].find((company) => company.slug === slug);
    return found ? { ...found } : null;
  }

  async getContact(companyId: string): Promise<ContactRecord | null> {
    return this.contacts.get(companyId) ?? null;
  }

  async updateCompany(companyId: string, patch: CompanyPatch): Promise<CompanyRecord> {
    const current = this.require(companyId);
    const updated: CompanyRecord = { ...current, ...patch, updatedAt: this.clock() };
    this.companies.set(companyId, updated);
    return { ...updated };
  }

  async storeDossier(
    companyId: string,
    dossier: Omit<DossierRecord, 'companyId' | 'version'>,
    next: { status: CompanyStatus; statusReason: string | null; track: OutreachTrack },
  ): Promise<DossierRecord> {
    const current = this.require(companyId);
    const version = this.dossiers.filter((entry) => entry.companyId === companyId).length + 1;
    const record: DossierRecord = { companyId, version, ...dossier };
    this.dossiers.push(record);
    this.companies.set(companyId, {
      ...current,
      status: next.status,
      statusReason: next.statusReason,
      track: next.track,
      draftAttempts: 0,
      updatedAt: this.clock(),
    });
    this.events.push({ companyId, type: 'dossier.stored', payload: { version } });
    return record;
  }

  async getLatestDossier(companyId: string): Promise<DossierRecord | null> {
    const own = this.dossiers.filter((entry) => entry.companyId === companyId);
    return own.length > 0 ? own[own.length - 1] : null;
  }

  async storeDraft(companyId: string, draft: NewDraft): Promise<DraftRecord> {
    const current = this.require(companyId);
    for (const existing of this.drafts) {
      if (existing.companyId === companyId && existing.status === 'awaiting_review') existing.status = 'superseded';
    }
    const version = this.drafts.filter((entry) => entry.companyId === companyId).length + 1;
    const record: DraftRecord = {
      ...draft,
      id: `draft-${this.nextId++}`,
      companyId,
      version,
      status: 'awaiting_review',
    };
    this.drafts.push(record);
    this.companies.set(companyId, { ...current, status: 'awaiting_review', statusReason: null, draftAttempts: 0, updatedAt: this.clock() });
    this.events.push({ companyId, type: 'draft.stored', payload: { version, generic: draft.generic } });
    return record;
  }

  async getLatestDraft(companyId: string): Promise<DraftRecord | null> {
    const own = this.drafts.filter((entry) => entry.companyId === companyId && entry.status !== 'superseded');
    return own.length > 0 ? own[own.length - 1] : null;
  }

  async listLatestDrafts(runId?: string): Promise<DraftRecord[]> {
    const result: DraftRecord[] = [];
    for (const company of this.companies.values()) {
      if (runId !== undefined && company.runId !== runId) continue;
      const own = this.drafts.filter((entry) => entry.companyId === company.id && entry.status !== 'superseded');
      if (own.length > 0) result.push(own[own.length - 1]);
    }
    return result;
  }

  async recordEvent(companyId: string | null, type: string, payload: Record<string, unknown>): Promise<void> {
    this.events.push({ companyId, type, payload });
  }

  async getCompany(companyId: string): Promise<CompanyRecord | null> {
    const found = this.companies.get(companyId);
    return found ? { ...found } : null;
  }

  async getDraft(draftId: string): Promise<DraftRecord | null> {
    const found = this.drafts.find((draft) => draft.id === draftId);
    return found ? { ...found } : null;
  }

  async reviewDraft(companyId: string, draftId: string, decision: 'approved' | 'killed'): Promise<void> {
    const company = this.require(companyId);
    const draft = this.drafts.find((entry) => entry.id === draftId && entry.companyId === companyId);
    if (!draft) throw new Error(`no draft ${draftId} for ${companyId}`);
    draft.status = decision;
    this.companies.set(companyId, { ...company, status: decision, statusReason: null, updatedAt: this.clock() });
    if (decision === 'killed') this.cancelUnsent(companyId, 'company killed');
    this.events.push({ companyId, type: `draft.${decision}`, payload: { draftId } });
  }

  async listSends(filter: { statuses?: readonly SendStatus[] } = {}): Promise<SendRecord[]> {
    return this.sends
      .filter((send) => filter.statuses === undefined || filter.statuses.includes(send.status))
      .map((send) => ({ ...send }));
  }

  async createSend(input: { draftId: string; kind: SendKind; scheduledAt: Date }): Promise<SendRecord | null> {
    const draft = this.drafts.find((entry) => entry.id === input.draftId);
    if (!draft) throw new Error(`no draft ${input.draftId}`);
    if (this.sends.some((send) => send.draftId === input.draftId && send.kind === input.kind)) return null;
    const record: SendRecord = {
      id: `send-${this.nextId++}`,
      draftId: input.draftId,
      companyId: draft.companyId,
      kind: input.kind,
      status: 'scheduled',
      scheduledAt: input.scheduledAt,
      sentAt: null,
      providerMessageId: null,
      providerThreadId: null,
      error: null,
      updatedAt: this.clock(),
    };
    this.sends.push(record);
    if (input.kind === 'initial') this.setCompanyStatus(draft.companyId, 'scheduled');
    return { ...record };
  }

  async claimSend(sendId: string): Promise<boolean> {
    const send = this.requireSend(sendId);
    if (send.status !== 'scheduled') return false;
    send.status = 'sending';
    send.updatedAt = this.clock();
    return true;
  }

  async requeueFailedSend(sendId: string, scheduledAt: Date): Promise<boolean> {
    const send = this.requireSend(sendId);
    if (send.status !== 'failed') return false;
    Object.assign(send, { status: 'scheduled', scheduledAt, error: null, updatedAt: this.clock() });
    return true;
  }

  async completeSend(
    sendId: string,
    result: { sentAt: Date; providerMessageId: string | null; providerThreadId: string; error?: string | null },
  ): Promise<void> {
    const send = this.requireSend(sendId);
    if (send.status !== 'sending') throw new Error(`send ${sendId} is ${send.status}, not sending`);
    Object.assign(send, {
      status: 'sent',
      sentAt: result.sentAt,
      providerMessageId: result.providerMessageId,
      providerThreadId: result.providerThreadId,
      error: result.error ?? null,
      updatedAt: this.clock(),
    });
    if (send.kind === 'initial') this.setCompanyStatus(send.companyId, 'sent');
  }

  async updateSend(sendId: string, patch: SendPatch): Promise<SendRecord> {
    const send = this.requireSend(sendId);
    Object.assign(send, patch, { updatedAt: this.clock() });
    return { ...send };
  }

  async recordInbound(companyId: string, outcome: InboundOutcome): Promise<void> {
    this.setCompanyStatus(companyId, outcome.status, outcome.statusReason);
    this.cancelUnsent(companyId, outcome.status);
    if (outcome.suppressEmail) {
      const email = outcome.suppressEmail.email.trim().toLowerCase();
      if (!this.suppressions.emails.includes(email)) {
        this.suppressions = { ...this.suppressions, emails: [...this.suppressions.emails, email] };
      }
    }
    this.events.push({ companyId, type: `inbound.${outcome.status}`, payload: {} });
  }

  async acquireLease(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = this.clock().getTime();
    const current = this.leases.get(name);
    if (current && current.expiresAt > now) return false;
    this.leases.set(name, { holder, expiresAt: now + ttlMs });
    return true;
  }

  async renewLease(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = this.clock().getTime();
    const current = this.leases.get(name);
    // Like the database, an expired lease is not renewable even by its last holder: it may have been taken over.
    if (!current || current.holder !== holder || current.expiresAt <= now) return false;
    this.leases.set(name, { holder, expiresAt: now + ttlMs });
    return true;
  }

  async releaseLease(name: string, holder: string): Promise<void> {
    if (this.leases.get(name)?.holder === holder) this.leases.delete(name);
  }

  async pruneCompanyData(companyId: string): Promise<void> {
    this.require(companyId);
    this.contacts.delete(companyId);
    for (let index = this.dossiers.length - 1; index >= 0; index -= 1) {
      if (this.dossiers[index].companyId === companyId) this.dossiers.splice(index, 1);
    }
    for (const draft of this.drafts) {
      if (draft.companyId !== companyId) continue;
      Object.assign(draft, {
        subject: '',
        body: '',
        followUpBody: '',
        cta: '',
        hookClaimId: null,
        followUpClaimId: null,
        anchorPhrase: null,
        mentionedProjects: [],
        tailoring: null,
        resumePdfPath: '',
      });
    }
    // Event payloads can hold draft text (verifier sentences, approval reasons); the audit trail keeps only types and times.
    for (const event of this.events) {
      if (event.companyId === companyId) event.payload = {};
    }
    this.events.push({ companyId, type: 'company.pruned', payload: {} });
  }

  private setCompanyStatus(companyId: string, status: CompanyStatus, statusReason: string | null = null): void {
    this.companies.set(companyId, { ...this.require(companyId), status, statusReason, updatedAt: this.clock() });
  }

  private cancelUnsent(companyId: string, reason: string): void {
    for (const send of this.sends) {
      if (send.companyId === companyId && send.status === 'scheduled') {
        Object.assign(send, { status: 'cancelled', error: reason, updatedAt: this.clock() });
      }
    }
  }

  private requireSend(sendId: string): SendRecord {
    const send = this.sends.find((entry) => entry.id === sendId);
    if (!send) throw new Error(`no send ${sendId}`);
    return send;
  }

  private require(companyId: string): CompanyRecord {
    const company = this.companies.get(companyId);
    if (!company) throw new Error(`no company ${companyId}`);
    return company;
  }
}

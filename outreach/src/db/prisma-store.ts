import { Prisma, PrismaClient } from '../generated/prisma';
import type {
  OutreachClaim,
  OutreachDossier,
  OutreachLanguage,
  OutreachTailoring,
  OutreachTrack,
} from '../schemas/outreach';

import { DuplicateCompanyError } from './outreach-store';
import { qualifiedTable } from './sql-identifiers';
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
} from './outreach-store';

// Prisma returns Json columns as JsonValue; every value written here was
// validated by zod first, so reading it back is a cast, not a re-parse.

type CompanyRow = Prisma.OutreachCompanyGetPayload<Record<string, never>>;
type DraftRow = Prisma.OutreachDraftGetPayload<Record<string, never>>;
type SendRow = Prisma.OutreachSendGetPayload<{ include: { draft: { select: { companyId: true } } } }>;

const SEND_INCLUDE = { draft: { select: { companyId: true } } } as const;

function toCompany(row: CompanyRow): CompanyRecord {
  return {
    id: row.id,
    runId: row.runId,
    slug: row.slug,
    name: row.name,
    domain: row.domain,
    domainKey: row.domainKey,
    website: row.website,
    status: row.status,
    statusReason: row.statusReason,
    draftAttempts: row.draftAttempts,
    track: row.track,
    updatedAt: row.updatedAt,
  };
}

function toDraft(row: DraftRow): DraftRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    version: row.version,
    status: row.status,
    generic: row.generic,
    language: row.language as OutreachLanguage,
    subject: row.subject,
    body: row.body,
    followUpBody: row.followUpBody,
    cta: row.cta,
    hookClaimId: row.hookClaimId,
    followUpClaimId: row.followUpClaimId,
    anchorPhrase: row.anchorPhrase,
    mentionedProjects: row.mentionedProjects,
    tailoring: row.tailoring as OutreachTailoring | null,
    resumeKind: row.resumeKind,
    track: row.track,
    resumePdfPath: row.resumePdfPath,
  };
}

function toSend(row: SendRow): SendRecord {
  return {
    id: row.id,
    draftId: row.draftId,
    companyId: row.draft.companyId,
    kind: row.kind,
    status: row.status,
    scheduledAt: row.scheduledAt,
    sentAt: row.sentAt,
    providerMessageId: row.providerMessageId,
    providerThreadId: row.providerThreadId,
    error: row.error,
    updatedAt: row.updatedAt,
  };
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

export class PrismaOutreachStore implements OutreachStore {
  private readonly leaseTable: Prisma.Sql;

  /** `schema` is the one in OUTREACH_DATABASE_URL; the lease SQL names its table with it (see sql-identifiers.ts). */
  constructor(
    private readonly db: PrismaClient,
    schema: string,
  ) {
    this.leaseTable = Prisma.raw(qualifiedTable(schema, 'OutreachLease'));
  }

  async listDomainKeys(): Promise<string[]> {
    const rows = await this.db.outreachCompany.findMany({ select: { domainKey: true } });
    return rows.map((row) => row.domainKey);
  }

  async listSuppressions(): Promise<SuppressionList> {
    const rows = await this.db.outreachSuppression.findMany({ select: { kind: true, value: true } });
    return {
      emails: rows.filter((row) => row.kind === 'email').map((row) => row.value),
      domains: rows.filter((row) => row.kind === 'domain').map((row) => row.value),
    };
  }

  async insertCompany(input: NewCompany): Promise<CompanyRecord> {
    try {
      const row = await this.db.outreachCompany.create({
        data: {
          runId: input.runId,
          slug: input.slug,
          name: input.name,
          domain: input.domain,
          domainKey: input.domainKey,
          website: input.website,
          contacts: { create: [input.contact] },
        },
      });
      return toCompany(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateCompanyError(`${input.domainKey} is already in the database`);
      throw error;
    }
  }

  async listCompanies(filter: CompanyFilter = {}): Promise<CompanyRecord[]> {
    const rows = await this.db.outreachCompany.findMany({
      where: {
        ...(filter.runId === undefined ? {} : { runId: filter.runId }),
        ...(filter.statuses === undefined ? {} : { status: { in: [...filter.statuses] } }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toCompany);
  }

  async getCompanyBySlug(slug: string): Promise<CompanyRecord | null> {
    const row = await this.db.outreachCompany.findUnique({ where: { slug } });
    return row ? toCompany(row) : null;
  }

  async getContact(companyId: string): Promise<ContactRecord | null> {
    const row = await this.db.outreachContact.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
    return row
      ? {
          companyId: row.companyId,
          email: row.email,
          name: row.name,
          role: row.role,
          roleAccount: row.roleAccount,
          mxStatus: row.mxStatus,
          emailSource: row.emailSource,
          contactConfidence: row.contactConfidence,
        }
      : null;
  }

  async updateCompany(companyId: string, patch: CompanyPatch): Promise<CompanyRecord> {
    const row = await this.db.outreachCompany.update({ where: { id: companyId }, data: patch });
    return toCompany(row);
  }

  async storeDossier(
    companyId: string,
    dossier: Omit<DossierRecord, 'companyId' | 'version'>,
    next: { status: CompanyStatus; statusReason: string | null; track: OutreachTrack },
  ): Promise<DossierRecord> {
    return this.db.$transaction(async (tx) => {
      const latest = await tx.outreachDossier.findFirst({
        where: { companyId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      await tx.outreachDossier.create({
        data: {
          companyId,
          version,
          data: asJson(dossier.data),
          rejectedClaims: asJson(dossier.rejectedClaims),
          verifiedClaimCount: dossier.verifiedClaimCount,
          country: dossier.data.country,
          language: dossier.data.language,
          timezone: dossier.data.timezone,
          fitScore: dossier.data.fit.score,
          track: dossier.data.fit.track,
        },
      });
      await tx.outreachCompany.update({
        where: { id: companyId },
        data: { status: next.status, statusReason: next.statusReason, track: next.track, draftAttempts: 0 },
      });
      await tx.outreachEvent.create({
        data: {
          companyId,
          type: 'dossier.stored',
          payload: asJson({ version, status: next.status, verifiedClaims: dossier.verifiedClaimCount }),
        },
      });
      return { companyId, version, ...dossier };
    });
  }

  async getLatestDossier(companyId: string): Promise<DossierRecord | null> {
    const row = await this.db.outreachDossier.findFirst({ where: { companyId }, orderBy: { version: 'desc' } });
    if (!row) return null;
    return {
      companyId,
      version: row.version,
      data: row.data as unknown as OutreachDossier,
      rejectedClaims: row.rejectedClaims as unknown as Array<{ claim: OutreachClaim; reason: string }>,
      verifiedClaimCount: row.verifiedClaimCount,
    };
  }

  async storeDraft(companyId: string, draft: NewDraft): Promise<DraftRecord> {
    return this.db.$transaction(async (tx) => {
      const latest = await tx.outreachDraft.findFirst({
        where: { companyId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      await tx.outreachDraft.updateMany({
        where: { companyId, status: 'awaiting_review' },
        data: { status: 'superseded' },
      });
      const row = await tx.outreachDraft.create({
        data: {
          companyId,
          version,
          generic: draft.generic,
          language: draft.language,
          subject: draft.subject,
          body: draft.body,
          followUpBody: draft.followUpBody,
          cta: draft.cta,
          hookClaimId: draft.hookClaimId,
          followUpClaimId: draft.followUpClaimId ?? null,
          anchorPhrase: draft.anchorPhrase,
          mentionedProjects: draft.mentionedProjects,
          tailoring: draft.tailoring === null ? Prisma.DbNull : asJson(draft.tailoring),
          resumeKind: draft.resumeKind,
          track: draft.track,
          resumePdfPath: draft.resumePdfPath,
        },
      });
      await tx.outreachCompany.update({
        where: { id: companyId },
        data: { status: 'awaiting_review', statusReason: null, draftAttempts: 0 },
      });
      await tx.outreachEvent.create({
        data: {
          companyId,
          type: 'draft.stored',
          payload: asJson({ version, generic: draft.generic, resumeKind: draft.resumeKind }),
        },
      });
      return toDraft(row);
    });
  }

  async getLatestDraft(companyId: string): Promise<DraftRecord | null> {
    const row = await this.db.outreachDraft.findFirst({ where: { companyId }, orderBy: { version: 'desc' } });
    return row ? toDraft(row) : null;
  }

  async listLatestDrafts(runId?: string): Promise<DraftRecord[]> {
    const companies = await this.db.outreachCompany.findMany({
      where: runId === undefined ? {} : { runId },
      select: { id: true },
    });
    const rows = await this.db.outreachDraft.findMany({
      where: { companyId: { in: companies.map((company) => company.id) }, status: { not: 'superseded' } },
      orderBy: [{ companyId: 'asc' }, { version: 'desc' }],
    });
    const seen = new Set<string>();
    return rows.filter((row) => !seen.has(row.companyId) && seen.add(row.companyId)).map(toDraft);
  }

  async recordEvent(companyId: string | null, type: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.outreachEvent.create({ data: { companyId, type, payload: asJson(payload) } });
  }

  async getCompany(companyId: string): Promise<CompanyRecord | null> {
    const row = await this.db.outreachCompany.findUnique({ where: { id: companyId } });
    return row ? toCompany(row) : null;
  }

  async getDraft(draftId: string): Promise<DraftRecord | null> {
    const row = await this.db.outreachDraft.findUnique({ where: { id: draftId } });
    return row ? toDraft(row) : null;
  }

  async reviewDraft(companyId: string, draftId: string, decision: 'approved' | 'killed'): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.outreachDraft.update({ where: { id: draftId }, data: { status: decision } });
      await tx.outreachCompany.update({ where: { id: companyId }, data: { status: decision, statusReason: null } });
      if (decision === 'killed') {
        await tx.outreachSend.updateMany({
          where: { draft: { companyId }, status: 'scheduled' },
          data: { status: 'cancelled', error: 'company killed' },
        });
      }
      await tx.outreachEvent.create({ data: { companyId, type: `draft.${decision}`, payload: asJson({ draftId }) } });
    });
  }

  async listSends(filter: { statuses?: readonly SendStatus[] } = {}): Promise<SendRecord[]> {
    const rows = await this.db.outreachSend.findMany({
      where: filter.statuses === undefined ? {} : { status: { in: [...filter.statuses] } },
      include: SEND_INCLUDE,
      orderBy: { scheduledAt: 'asc' },
    });
    return rows.map(toSend);
  }

  async createSend(input: { draftId: string; kind: SendKind; scheduledAt: Date }): Promise<SendRecord | null> {
    try {
      return await this.db.$transaction(async (tx) => {
        const row = await tx.outreachSend.create({
          data: { draftId: input.draftId, kind: input.kind, scheduledAt: input.scheduledAt },
          include: SEND_INCLUDE,
        });
        if (input.kind === 'initial') {
          await tx.outreachCompany.update({ where: { id: row.draft.companyId }, data: { status: 'scheduled' } });
        }
        return toSend(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async claimSend(sendId: string): Promise<boolean> {
    const { count } = await this.db.outreachSend.updateMany({
      where: { id: sendId, status: 'scheduled' },
      data: { status: 'sending' },
    });
    return count === 1;
  }

  async requeueFailedSend(sendId: string, scheduledAt: Date): Promise<boolean> {
    const { count } = await this.db.outreachSend.updateMany({
      where: { id: sendId, status: 'failed' },
      data: { status: 'scheduled', scheduledAt, error: null },
    });
    return count === 1;
  }

  async completeSend(
    sendId: string,
    result: { sentAt: Date; providerMessageId: string | null; providerThreadId: string; error?: string | null },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.outreachSend.updateMany({
        where: { id: sendId, status: 'sending' },
        data: {
          status: 'sent',
          sentAt: result.sentAt,
          providerMessageId: result.providerMessageId,
          providerThreadId: result.providerThreadId,
          error: result.error ?? null,
        },
      });
      if (count !== 1) throw new Error(`send ${sendId} is not in the sending state`);
      const row = await tx.outreachSend.findUniqueOrThrow({ where: { id: sendId }, include: SEND_INCLUDE });
      if (row.kind === 'initial') {
        await tx.outreachCompany.update({ where: { id: row.draft.companyId }, data: { status: 'sent' } });
      }
    });
  }

  async updateSend(sendId: string, patch: SendPatch): Promise<SendRecord> {
    const row = await this.db.outreachSend.update({ where: { id: sendId }, data: patch, include: SEND_INCLUDE });
    return toSend(row);
  }

  async recordInbound(companyId: string, outcome: InboundOutcome): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.outreachCompany.update({
        where: { id: companyId },
        data: { status: outcome.status, statusReason: outcome.statusReason },
      });
      await tx.outreachSend.updateMany({
        where: { draft: { companyId }, status: 'scheduled' },
        data: { status: 'cancelled', error: outcome.status },
      });
      if (outcome.suppressEmail) {
        const value = outcome.suppressEmail.email.trim().toLowerCase();
        await tx.outreachSuppression.upsert({
          where: { kind_value: { kind: 'email', value } },
          create: { kind: 'email', value, reason: outcome.suppressEmail.reason },
          update: {},
        });
      }
      await tx.outreachEvent.create({
        data: { companyId, type: `inbound.${outcome.status}`, payload: asJson({ optOut: Boolean(outcome.suppressEmail) }) },
      });
    });
  }

  async acquireLease(name: string, holder: string, ttlMs: number): Promise<boolean> {
    // One statement: insert, or take over only a lease that has expired. No row back means someone else holds it.
    const rows = await this.db.$queryRaw<Array<{ holder: string }>>`
      INSERT INTO ${this.leaseTable} ("name", "holder", "expiresAt")
      VALUES (${name}, ${holder}, now() + make_interval(secs => ${ttlMs / 1000}::double precision))
      ON CONFLICT ("name") DO UPDATE
        SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
        WHERE ${this.leaseTable}."expiresAt" < now()
      RETURNING "holder"`;
    return rows.length === 1;
  }

  async renewLease(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const updated = await this.db.$executeRaw`
      UPDATE ${this.leaseTable}
      SET "expiresAt" = now() + make_interval(secs => ${ttlMs / 1000}::double precision)
      WHERE "name" = ${name} AND "holder" = ${holder} AND "expiresAt" > now()`;
    return updated === 1;
  }

  async releaseLease(name: string, holder: string): Promise<void> {
    await this.db.outreachLease.deleteMany({ where: { name, holder } });
  }

  async pruneCompanyData(companyId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.outreachContact.deleteMany({ where: { companyId } });
      await tx.outreachDossier.deleteMany({ where: { companyId } });
      await tx.outreachDraft.updateMany({
        where: { companyId },
        data: {
          subject: '',
          body: '',
          followUpBody: '',
          cta: '',
          hookClaimId: null,
          followUpClaimId: null,
          anchorPhrase: null,
          mentionedProjects: [],
          tailoring: Prisma.DbNull,
          resumePdfPath: '',
        },
      });
      // Event payloads can hold draft text (verifier sentences, approval reasons); the audit trail keeps only types and times.
      await tx.outreachEvent.updateMany({ where: { companyId }, data: { payload: {} } });
      await tx.outreachEvent.create({ data: { companyId, type: 'company.pruned', payload: {} } });
    });
  }
}

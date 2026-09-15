import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MasterDB } from '@resumiq/schemas';

type Json = Prisma.InputJsonValue;

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<MasterDB | null> {
    const profile = await this.prisma.careerProfile.findUnique({
      where: { userId },
    });
    if (!profile) return null;
    return this.toMasterDB(profile);
  }

  async upsertProfile(userId: string, data: Partial<MasterDB>): Promise<MasterDB> {
    return this.withUserLock(userId, async (tx) => {
      const existing = await this.readProfileTx(tx, userId);
      const merged = existing ? this.mergeMasterDB(existing, data) : (data as MasterDB);
      return this.writeProfileTx(tx, userId, merged);
    });
  }

  async mergeSection(
    userId: string,
    section: keyof MasterDB,
    entry: unknown,
  ): Promise<MasterDB> {
    return this.withUserLock(userId, async (tx) => {
      const existing = await this.readProfileTx(tx, userId);
      const base: MasterDB = existing ?? this.emptyMasterDB(userId);
      const merged = this.mergeSectionIntoProfile(base, section, entry);
      return this.writeProfileTx(tx, userId, merged);
    });
  }

  /**
   * Merges multiple section entries into a single in-memory profile snapshot,
   * then persists with exactly one write. Used by onboarding's multi-entry
   * ingest so that a batch of extracted entries lands atomically — either all
   * of them merge, or (on failure before this call resolves) none of them do.
   * This avoids the partial-commit-then-duplicate-on-retry issue that calling
   * `mergeSection` once per entry (each an independent read-then-write) would
   * cause.
   */
  async mergeSections(
    userId: string,
    entries: Array<{ section: keyof MasterDB; entry: unknown }>,
  ): Promise<MasterDB> {
    return this.withUserLock(userId, async (tx) => {
      const existing = await this.readProfileTx(tx, userId);
      let profile: MasterDB = existing ?? this.emptyMasterDB(userId);
      for (const { section, entry } of entries) {
        profile = this.mergeSectionIntoProfile(profile, section, entry);
      }
      return this.writeProfileTx(tx, userId, profile);
    });
  }

  /**
   * Merges an imported `MasterDB` profile (Phase 4 export/import) into the
   * existing one. Reuses `mergeSectionIntoProfile` per-section rather than
   * writing new merge logic: array sections (experience, projects, ...) are
   * exploded into one `{ section, entry }` pair per element so each entry is
   * *appended*, matching the exact append behavior `mergeSections` already
   * uses for onboarding's multi-entry ingest. `skills` hits the existing
   * dedupe-merge branch, and `personal_info` hits the existing scalar
   * "imported value replaces" branch — same as every other scalar profile
   * section merge in this codebase, not a new merge rule invented for import.
   */
  async importProfile(userId: string, data: MasterDB): Promise<MasterDB> {
    const entries: Array<{ section: keyof MasterDB; entry: unknown }> = [];
    for (const key of Object.keys(data) as Array<keyof MasterDB>) {
      const value = data[key];
      if (Array.isArray(value)) {
        for (const entry of value) entries.push({ section: key, entry });
      } else {
        entries.push({ section: key, entry: value });
      }
    }
    return this.mergeSections(userId, entries);
  }

  /**
   * Serializes all profile mutations for a given user behind a Postgres
   * transaction-scoped advisory lock (released automatically when the
   * transaction commits/rolls back). Prevents the read-merge-write race where
   * two concurrent mutations (e.g. two onboarding sections landing at once)
   * both read the same stale row and the second upsert silently clobbers the
   * first writer's change.
   *
   * `hashtext()` reduces userId to a 32-bit int, so two different userIds
   * could theoretically hash-collide and serialize unnecessarily against each
   * other — a performance nit, not a correctness bug, not worth the two-int
   * `pg_advisory_xact_lock` overload for this.
   */
  private async withUserLock<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      return work(tx);
    });
  }

  private async readProfileTx(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<MasterDB | null> {
    const profile = await tx.careerProfile.findUnique({ where: { userId } });
    if (!profile) return null;
    return this.toMasterDB(profile);
  }

  private async writeProfileTx(
    tx: Prisma.TransactionClient,
    userId: string,
    merged: MasterDB,
  ): Promise<MasterDB> {
    const strengthScore = this.computeStrengthScore(merged);

    const profile = await tx.careerProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...this.fromMasterDB(merged),
        strengthScore,
      },
      update: {
        ...this.fromMasterDB(merged),
        strengthScore,
      },
    });

    return this.toMasterDB(profile);
  }

  /** Pure merge of a single section entry into an in-memory profile — no DB access. */
  private mergeSectionIntoProfile(
    profile: MasterDB,
    section: keyof MasterDB,
    entry: unknown,
  ): MasterDB {
    const base: MasterDB = { ...profile };

    const sectionValue = base[section];
    if (Array.isArray(sectionValue)) {
      const alreadyExists = sectionValue.some(
        (existingEntry) => canonicalStringify(existingEntry) === canonicalStringify(entry),
      );
      (base[section] as unknown[]) = alreadyExists ? sectionValue : [...sectionValue, entry];
    } else if (section === 'skills' && typeof entry === 'object' && entry !== null) {
      base.skills = this.mergeSkills(base.skills, entry as Partial<MasterDB['skills']>);
    } else {
      (base[section] as unknown) = entry;
    }

    return base;
  }

  private mergeMasterDB(base: MasterDB, patch: Partial<MasterDB>): MasterDB {
    return { ...base, ...patch };
  }

  private mergeSkills(
    base: MasterDB['skills'],
    patch: Partial<MasterDB['skills']>,
  ): MasterDB['skills'] {
    return {
      programming_languages: dedupe([...(base.programming_languages ?? []), ...(patch.programming_languages ?? [])]),
      frameworks_and_libraries: dedupe([...(base.frameworks_and_libraries ?? []), ...(patch.frameworks_and_libraries ?? [])]),
      infrastructure_and_tools: dedupe([...(base.infrastructure_and_tools ?? []), ...(patch.infrastructure_and_tools ?? [])]),
      databases: dedupe([...(base.databases ?? []), ...(patch.databases ?? [])]),
      spoken_languages: base.spoken_languages ?? [],
      soft_skills: dedupe([...(base.soft_skills ?? []), ...(patch.soft_skills ?? [])]),
    };
  }

  private computeStrengthScore(db: MasterDB): number {
    let score = 0;
    if (db.personal_info?.name) score += 10;
    if (db.personal_info?.email) score += 5;
    if (db.education?.length) score += 15;
    if (db.experience?.length) score += 25;
    if (db.projects?.length) score += 20;
    if (db.skills?.programming_languages?.length) score += 10;
    if (db.skills?.frameworks_and_libraries?.length) score += 5;
    if (db.certifications?.length) score += 5;
    if (db.volunteering_and_leadership?.length) score += 3;
    if (db.publications_and_speaking?.length) score += 2;
    return Math.min(score, 100);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toMasterDB(row: any): MasterDB {
    return {
      personal_info: row.personalInfo as MasterDB['personal_info'],
      summaries: row.summaries as MasterDB['summaries'],
      experience: row.experience as MasterDB['experience'],
      education: row.education as MasterDB['education'],
      projects: row.projects as MasterDB['projects'],
      skills: row.skills as MasterDB['skills'],
      certifications: row.certifications as MasterDB['certifications'],
      awards_and_honors: row.awardsAndHonors as MasterDB['awards_and_honors'],
      publications_and_speaking: row.publicationsAndSpeaking as MasterDB['publications_and_speaking'],
      volunteering_and_leadership: row.volunteeringAndLeadership as MasterDB['volunteering_and_leadership'],
      interests: row.interests as MasterDB['interests'],
    };
  }

  private fromMasterDB(db: MasterDB) {
    const j = <T>(v: T): Json => v as unknown as Json;
    return {
      personalInfo: j(db.personal_info ?? {}),
      summaries: j(db.summaries ?? []),
      experience: j(db.experience ?? []),
      education: j(db.education ?? []),
      projects: j(db.projects ?? []),
      skills: j(db.skills ?? {}),
      certifications: j(db.certifications ?? []),
      awardsAndHonors: j(db.awards_and_honors ?? []),
      publicationsAndSpeaking: j(db.publications_and_speaking ?? []),
      volunteeringAndLeadership: j(db.volunteering_and_leadership ?? []),
      interests: j(db.interests ?? []),
    };
  }

  private emptyMasterDB(userId: string): MasterDB {
    void userId;
    return {
      personal_info: { name: '', location: '', phone: '', email: '', work_authorization: [], clearances: [], links: [] },
      summaries: [],
      experience: [],
      education: [],
      projects: [],
      skills: { programming_languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [], spoken_languages: [], soft_skills: [] },
      certifications: [],
      awards_and_honors: [],
      publications_and_speaking: [],
      volunteering_and_leadership: [],
      interests: [],
    };
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

/**
 * Deep-equality-safe stringify for comparing JSON-shaped values.
 *
 * Object keys are sorted recursively before serializing, so two entries with
 * the same properties in a different order compare equal. This matters
 * because the "imported" side of a comparison is rebuilt by Zod in
 * schema-declaration key order, while the "existing" side comes back from a
 * Postgres `jsonb` column, which returns keys in Postgres's own internal
 * canonical order — neither matches the other or the original upload, so a
 * raw `JSON.stringify` comparison would almost always report false
 * mismatches on identical data.
 *
 * Array element order is preserved (NOT sorted): two entries whose
 * array-of-strings fields (e.g. `technologies_used`) list the same items in
 * a different order are treated as genuinely different data.
 *
 * Only handles plain JSON-shaped values (objects, arrays, strings, numbers,
 * booleans, null) — the entries this is used for never contain anything
 * else (no Dates, functions, undefined, or circular references).
 */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

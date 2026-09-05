import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MasterDB } from '@resumiq/ai-bridge';

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
    const existing = await this.prisma.careerProfile.findUnique({ where: { userId } });

    const merged = existing ? this.mergeMasterDB(this.toMasterDB(existing), data) : (data as MasterDB);
    const strengthScore = this.computeStrengthScore(merged);

    const profile = await this.prisma.careerProfile.upsert({
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

  async mergeSection(
    userId: string,
    section: keyof MasterDB,
    entry: unknown,
  ): Promise<MasterDB> {
    const existing = await this.getProfile(userId);
    const base: MasterDB = existing ?? this.emptyMasterDB(userId);
    const merged = this.mergeSectionIntoProfile(base, section, entry);
    return this.upsertProfile(userId, merged);
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
    const existing = await this.getProfile(userId);
    let profile: MasterDB = existing ?? this.emptyMasterDB(userId);
    for (const { section, entry } of entries) {
      profile = this.mergeSectionIntoProfile(profile, section, entry);
    }
    return this.upsertProfile(userId, profile);
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
      (base[section] as unknown[]) = [...sectionValue, entry];
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

import { ProfileService } from './profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { MasterDB } from '@resumiq/ai-bridge';

function emptyMasterDB(): MasterDB {
  return {
    personal_info: {
      name: '',
      location: '',
      phone: '',
      email: '',
      work_authorization: [],
      clearances: [],
      links: [],
    },
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: {
      programming_languages: [],
      frameworks_and_libraries: [],
      infrastructure_and_tools: [],
      databases: [],
      spoken_languages: [],
      soft_skills: [],
    },
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
  };
}

// Mirrors ProfileService#fromMasterDB — turns a MasterDB into the shape
// stored on the CareerProfile row, so the mocked Prisma client can round-trip it.
function toRow(userId: string, db: MasterDB) {
  return {
    userId,
    personalInfo: db.personal_info,
    summaries: db.summaries,
    experience: db.experience,
    education: db.education,
    projects: db.projects,
    skills: db.skills,
    certifications: db.certifications,
    awardsAndHonors: db.awards_and_honors,
    publicationsAndSpeaking: db.publications_and_speaking,
    volunteeringAndLeadership: db.volunteering_and_leadership,
    interests: db.interests,
  };
}

describe('ProfileService', () => {
  let prisma: {
    careerProfile: { findUnique: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let service: ProfileService;

  beforeEach(() => {
    prisma = {
      careerProfile: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      // `withUserLock` runs work inside `prisma.$transaction`, passing a `tx`
      // client. Since every call site in this suite mutates through
      // `prisma.careerProfile` (not a separate `tx` object), the mocked
      // transaction just hands the same client back as `tx`.
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRaw: jest.fn(),
    };
    service = new ProfileService(prisma as unknown as PrismaService);
  });

  describe('per-user advisory lock (race condition fix)', () => {
    it('acquires the advisory lock before reading the profile, for each of upsertProfile/mergeSection/mergeSections', async () => {
      prisma.careerProfile.findUnique.mockResolvedValue(null);
      prisma.careerProfile.upsert.mockImplementation(async ({ create }) => ({
        userId: 'user-1',
        ...create,
      }));

      const callOrder: string[] = [];
      prisma.$executeRaw.mockImplementation(async () => {
        callOrder.push('lock');
      });
      prisma.careerProfile.findUnique.mockImplementation(async () => {
        callOrder.push('read');
        return null;
      });

      await service.upsertProfile('user-1', emptyMasterDB());
      await service.mergeSection('user-1', 'skills', { programming_languages: ['Go'] });
      await service.mergeSections('user-1', [
        { section: 'skills', entry: { programming_languages: ['Go'] } },
      ]);

      expect(callOrder).toEqual(['lock', 'read', 'lock', 'read', 'lock', 'read']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('serializes two concurrent mergeSection writes so neither silently overwrites the other', async () => {
      // Stands in for Postgres's advisory lock: a tiny mutex that forces
      // work items passed to `$transaction` to run strictly one-at-a-time,
      // reproducing the serialization `pg_advisory_xact_lock` provides
      // against the real database.
      let queue: Promise<unknown> = Promise.resolve();
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
        const run = queue.then(() => cb(prisma));
        queue = run.catch(() => undefined);
        return run;
      });

      let stored: ReturnType<typeof toRow> | null = toRow('user-1', emptyMasterDB());
      prisma.careerProfile.findUnique.mockImplementation(async () => stored);
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => {
        // Simulate a real DB doing work between read and write, widening the
        // race window so an unserialized pair of writers would interleave.
        await new Promise((resolve) => setTimeout(resolve, 0));
        stored = { userId: 'user-1', ...update };
        return stored;
      });

      const experienceEntry = {
        company: 'Acme',
        company_industry: '',
        role: 'Engineer',
        location: '',
        location_type: '',
        startDate: '2020',
        endDate: '2022',
        isCurrent: false,
        core_competencies: [],
        technologies_used: [],
        raw_achievements: [],
        quantifiable_metrics: [],
      };
      const educationEntry = {
        institution: 'MIT',
        degree_type: 'BSc',
        major: 'CS',
        minor: '',
        location: '',
        startDate: '2016',
        endDate: '2020',
        gpa: '',
        honors: [],
        relevant_coursework: [],
        thesis_or_capstone: '',
        extracurriculars: [],
        description: '',
      };

      const [resultA, resultB] = await Promise.all([
        service.mergeSection('user-1', 'experience', experienceEntry),
        service.mergeSection('user-1', 'education', educationEntry),
      ]);

      expect(resultB.experience).toEqual([experienceEntry]);
      expect(resultB.education).toEqual([educationEntry]);
      expect(resultA).toBeDefined();
    });
  });

  describe('skills merge/dedupe (via mergeSection)', () => {
    it('dedupes overlapping skills when merging a new skills entry into an existing profile', async () => {
      const existing = emptyMasterDB();
      existing.skills.programming_languages = ['TypeScript', 'Python'];
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      await service.mergeSection('user-1', 'skills', {
        programming_languages: ['Python', 'Go'],
      });

      const upsertArgs = prisma.careerProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.update.skills.programming_languages).toEqual([
        'TypeScript',
        'Python',
        'Go',
      ]);
    });

    it('trims whitespace and drops empty strings when merging skills', async () => {
      const existing = emptyMasterDB();
      existing.skills.soft_skills = ['Leadership'];
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      await service.mergeSection('user-1', 'skills', {
        soft_skills: ['  Communication  ', '', 'Leadership'],
      });

      const upsertArgs = prisma.careerProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.update.skills.soft_skills).toEqual(['Leadership', 'Communication']);
    });

    it('appends a new array-section entry (e.g. experience) without touching skills', async () => {
      const existing = emptyMasterDB();
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      const newExperience = {
        company: 'Acme',
        company_industry: 'Software',
        role: 'Engineer',
        location: 'Remote',
        location_type: 'remote',
        startDate: '2020-01',
        endDate: '2022-01',
        isCurrent: false,
        core_competencies: [],
        technologies_used: [],
        raw_achievements: [],
        quantifiable_metrics: [],
      };

      await service.mergeSection('user-1', 'experience', newExperience);

      const upsertArgs = prisma.careerProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.update.experience).toEqual([newExperience]);
    });
  });

  describe('mergeSections (atomic multi-entry merge)', () => {
    it('reads the profile once and writes once for a batch of entries across multiple sections', async () => {
      const existing = emptyMasterDB();
      existing.skills.programming_languages = ['TypeScript'];
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      const newExperience = {
        company: 'Acme',
        company_industry: 'Software',
        role: 'Engineer',
        location: 'Remote',
        location_type: 'remote',
        startDate: '2020-01',
        endDate: '2022-01',
        isCurrent: false,
        core_competencies: [],
        technologies_used: [],
        raw_achievements: [],
        quantifiable_metrics: [],
      };
      const newCertification = {
        name: 'AWS Certified Developer',
        issuer: 'AWS',
        date: '2023',
        expiration_date: '',
        credential_id: '',
        link: '',
        description: '',
      };

      const result = await service.mergeSections('user-1', [
        { section: 'experience', entry: newExperience },
        { section: 'certifications', entry: newCertification },
        { section: 'skills', entry: { programming_languages: ['Go'] } },
      ]);

      expect(prisma.careerProfile.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.careerProfile.upsert).toHaveBeenCalledTimes(1);
      expect(result.experience).toEqual([newExperience]);
      expect(result.certifications).toEqual([newCertification]);
      expect(result.skills.programming_languages).toEqual(['TypeScript', 'Go']);
    });

    it('merges every entry into one in-memory profile without writing per entry, even when the batch is large', async () => {
      prisma.careerProfile.findUnique.mockResolvedValue(null);
      prisma.careerProfile.upsert.mockImplementation(async ({ create }) => ({
        userId: 'user-1',
        ...create,
      }));

      const certs = Array.from({ length: 5 }, (_, i) => ({
        name: `Cert ${i}`,
        issuer: '',
        date: '',
        expiration_date: '',
        credential_id: '',
        link: '',
        description: '',
      }));

      const result = await service.mergeSections(
        'user-1',
        certs.map((entry) => ({ section: 'certifications' as const, entry })),
      );

      expect(prisma.careerProfile.upsert).toHaveBeenCalledTimes(1);
      expect(result.certifications).toEqual(certs);
    });
  });

  describe('importProfile (Phase 4 export/import)', () => {
    const existingExperience = {
      company: 'Old Co',
      company_industry: '',
      role: 'Engineer',
      location: '',
      location_type: '',
      startDate: '2018-01',
      endDate: '2020-01',
      isCurrent: false,
      core_competencies: [],
      technologies_used: [],
      raw_achievements: [],
      quantifiable_metrics: [],
    };
    const importedExperience = {
      company: 'New Co',
      company_industry: '',
      role: 'Senior Engineer',
      location: '',
      location_type: '',
      startDate: '2020-01',
      endDate: '',
      isCurrent: true,
      core_competencies: [],
      technologies_used: [],
      raw_achievements: [],
      quantifiable_metrics: [],
    };

    function importedMasterDB(): MasterDB {
      const db = emptyMasterDB();
      db.personal_info = {
        name: 'New Name',
        location: 'Remote',
        phone: '',
        email: 'new@example.com',
        work_authorization: [],
        clearances: [],
        links: [],
      };
      db.experience = [importedExperience];
      db.skills.programming_languages = ['Python', 'Go'];
      return db;
    }

    it('appends imported array-section entries to the existing ones, dedupe-merges skills, and wholly replaces personal_info', async () => {
      const existing = emptyMasterDB();
      existing.personal_info.name = 'Old Name';
      existing.experience = [existingExperience];
      existing.skills.programming_languages = ['TypeScript', 'Python'];
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      const result = await service.importProfile('user-1', importedMasterDB());

      expect(result.experience).toEqual([existingExperience, importedExperience]);
      expect(result.personal_info.name).toBe('New Name');
      expect(result.personal_info.email).toBe('new@example.com');
      expect(result.skills.programming_languages).toEqual(['TypeScript', 'Python', 'Go']);
    });

    it('does not duplicate array-section entries when the same export is re-imported, but still appends a genuinely new entry', async () => {
      let stored = toRow('user-1', emptyMasterDB());
      prisma.careerProfile.findUnique.mockImplementation(async () => stored);
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => {
        stored = { userId: 'user-1', ...update };
        return stored;
      });

      const importPayload = importedMasterDB();
      await service.importProfile('user-1', importPayload);
      const reimportResult = await service.importProfile('user-1', importPayload);

      // Re-importing the identical payload must not duplicate the entry.
      expect(reimportResult.experience).toEqual([importedExperience]);

      const differentExperience = { ...importedExperience, company: 'Another Co' };
      const secondPayload = importedMasterDB();
      secondPayload.experience = [differentExperience];
      const secondResult = await service.importProfile('user-1', secondPayload);

      // A genuinely new/different entry is still appended normally.
      expect(secondResult.experience).toEqual([importedExperience, differentExperience]);
    });

    it('recognizes an existing entry as a duplicate even when its object keys are in a different order', async () => {
      // Simulates the real production mismatch: the imported side is
      // rebuilt by Zod in schema-declaration key order, while the existing
      // side comes back from a Postgres `jsonb` column in Postgres's own
      // canonical key order — never the same order, even for identical data.
      const existingEntrySameDataDifferentKeyOrder = {
        isCurrent: importedExperience.isCurrent,
        endDate: importedExperience.endDate,
        startDate: importedExperience.startDate,
        location_type: importedExperience.location_type,
        location: importedExperience.location,
        role: importedExperience.role,
        company_industry: importedExperience.company_industry,
        company: importedExperience.company,
        quantifiable_metrics: importedExperience.quantifiable_metrics,
        raw_achievements: importedExperience.raw_achievements,
        technologies_used: importedExperience.technologies_used,
        core_competencies: importedExperience.core_competencies,
      };
      const existing = emptyMasterDB();
      existing.experience = [existingEntrySameDataDifferentKeyOrder];
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      const result = await service.importProfile('user-1', importedMasterDB());

      expect(result.experience).toEqual([existingEntrySameDataDifferentKeyOrder]);
    });

    it('treats entries with the same object keys but a reordered array-of-strings sub-field as genuinely different (not deduped)', async () => {
      const existingEntryReorderedTechnologies = {
        ...importedExperience,
        technologies_used: ['Kubernetes', 'React'],
      };
      const importPayload = importedMasterDB();
      importPayload.experience = [{ ...importedExperience, technologies_used: ['React', 'Kubernetes'] }];

      const existing = emptyMasterDB();
      existing.experience = [existingEntryReorderedTechnologies];
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      const result = await service.importProfile('user-1', importPayload);

      expect(result.experience).toEqual([
        existingEntryReorderedTechnologies,
        importPayload.experience[0],
      ]);
    });

    it("only merges into the authenticated user's own profile, never another user's", async () => {
      const existing = emptyMasterDB();
      prisma.careerProfile.findUnique.mockResolvedValue(toRow('user-1', existing));
      prisma.careerProfile.upsert.mockImplementation(async ({ update }) => ({
        userId: 'user-1',
        ...update,
      }));

      await service.importProfile('user-1', importedMasterDB());

      expect(prisma.careerProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      const upsertArgs = prisma.careerProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ userId: 'user-1' });
      expect(upsertArgs.where.userId).not.toBe('user-2');
    });
  });

  describe('strength score computation (via upsertProfile)', () => {
    it('scores 0 for a completely empty profile', async () => {
      prisma.careerProfile.findUnique.mockResolvedValue(null);
      prisma.careerProfile.upsert.mockImplementation(async ({ create }) => ({
        userId: 'user-1',
        ...create,
      }));

      await service.upsertProfile('user-1', emptyMasterDB());

      const upsertArgs = prisma.careerProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.create.strengthScore).toBe(0);
    });

    it('accumulates points for each populated section, capped at 100', async () => {
      const full = emptyMasterDB();
      full.personal_info.name = 'Jane Doe';
      full.personal_info.email = 'jane@example.com';
      full.education = [
        {
          institution: 'MIT',
          degree_type: 'BSc',
          major: 'CS',
          minor: '',
          location: '',
          startDate: '2016',
          endDate: '2020',
          gpa: '',
          honors: [],
          relevant_coursework: [],
          thesis_or_capstone: '',
          extracurriculars: [],
          description: '',
        },
      ];
      full.experience = [
        {
          company: 'Acme',
          company_industry: '',
          role: 'Engineer',
          location: '',
          location_type: '',
          startDate: '2020',
          endDate: '2022',
          isCurrent: false,
          core_competencies: [],
          technologies_used: [],
          raw_achievements: [],
          quantifiable_metrics: [],
        },
      ];
      full.projects = [
        {
          name: 'Side project',
          context: '',
          links: [],
          startDate: '',
          endDate: '',
          technologies_used: [],
          raw_achievements: [],
          quantifiable_metrics: [],
        },
      ];
      full.skills.programming_languages = ['TypeScript'];
      full.skills.frameworks_and_libraries = ['React'];
      full.certifications = [
        { name: '', issuer: '', date: '', expiration_date: '', credential_id: '', link: '', description: '' },
      ];

      prisma.careerProfile.findUnique.mockResolvedValue(null);
      prisma.careerProfile.upsert.mockImplementation(async ({ create }) => ({
        userId: 'user-1',
        ...create,
      }));

      await service.upsertProfile('user-1', full);

      const upsertArgs = prisma.careerProfile.upsert.mock.calls[0][0];
      // 10 (name) + 5 (email) + 15 (education) + 25 (experience) + 20 (projects)
      // + 10 (programming_languages) + 5 (frameworks) + 5 (certifications) = 95
      expect(upsertArgs.create.strengthScore).toBe(95);
    });

    it('caps the strength score at 100 even when every section is populated', async () => {
      const full = emptyMasterDB();
      full.personal_info.name = 'Jane Doe';
      full.personal_info.email = 'jane@example.com';
      full.education = [{ institution: 'MIT' } as MasterDB['education'][number]];
      full.experience = [{ company: 'Acme' } as MasterDB['experience'][number]];
      full.projects = [{ name: 'Project' } as MasterDB['projects'][number]];
      full.skills.programming_languages = ['TypeScript'];
      full.skills.frameworks_and_libraries = ['React'];
      full.certifications = [{ name: 'AWS' } as MasterDB['certifications'][number]];
      full.volunteering_and_leadership = [
        { organization: 'Org' } as MasterDB['volunteering_and_leadership'][number],
      ];
      full.publications_and_speaking = [
        { title: 'Paper' } as MasterDB['publications_and_speaking'][number],
      ];

      prisma.careerProfile.findUnique.mockResolvedValue(null);
      prisma.careerProfile.upsert.mockImplementation(async ({ create }) => ({
        userId: 'user-1',
        ...create,
      }));

      await service.upsertProfile('user-1', full);

      const upsertArgs = prisma.careerProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.create.strengthScore).toBeLessThanOrEqual(100);
    });
  });
});

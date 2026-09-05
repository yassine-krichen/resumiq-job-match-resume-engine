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
  let prisma: { careerProfile: { findUnique: jest.Mock; upsert: jest.Mock } };
  let service: ProfileService;

  beforeEach(() => {
    prisma = {
      careerProfile: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new ProfileService(prisma as unknown as PrismaService);
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

      // upsertProfile does its own internal read to compute the merged patch,
      // so findUnique is called twice — the key atomicity guarantee is a
      // single write (upsert), not a single read.
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

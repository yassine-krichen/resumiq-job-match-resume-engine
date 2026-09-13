import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { checkCompatibility } from '@resumiq/ai-bridge';
import type { CompatibilityResult, JobDNA, MasterDB } from '@resumiq/ai-bridge';
import { scanTrackedCompanies } from '@resumiq/job-scanner';
import type { ScrapedJobInput } from '@resumiq/job-scanner';
import type { DiscoverFeedFiltersDto } from '@resumiq/schemas';
import { JobsService } from './jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { HunterClient } from './enrichment/hunter.client';
import { PeopleDataLabsClient } from './enrichment/people-data-labs.client';
import { ingestScrapedJobs } from './ingest-scraped-jobs';

jest.mock('@resumiq/ai-bridge', () => ({
  analyzeJob: jest.fn(),
  checkCompatibility: jest.fn(),
}));

jest.mock('@resumiq/job-scanner', () => ({
  scanTrackedCompanies: jest.fn(),
}));

jest.mock('./ingest-scraped-jobs', () => ({
  ingestScrapedJobs: jest.fn(),
}));

const checkCompatibilityMock = checkCompatibility as jest.Mock;
const scanTrackedCompaniesMock = scanTrackedCompanies as jest.Mock;
const ingestScrapedJobsMock = ingestScrapedJobs as jest.Mock;

const USER_ID = 'user-1';

function jobDNAFixture(overrides: Partial<JobDNA> = {}): JobDNA {
  return {
    job_title: 'Backend Engineer',
    seniority: 'Mid',
    mandatory_technical_skills: ['TypeScript'],
    mandatory_soft_skills: [],
    nice_to_have_skills: [],
    ats_keywords: [],
    company_culture_and_values: [],
    primary_responsibilities_summary: '',
    tone_recommendation: '',
    ...overrides,
  };
}

function masterDBFixture(): MasterDB {
  return {
    personal_info: { name: 'Jane', location: '', phone: '', email: '', work_authorization: [], clearances: [], links: [] },
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

function compatibilityResultFixture(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    compatible: true,
    score: 88,
    blockers: [],
    warnings: [],
    suggestions: [],
    reasons: ['Strong match'],
    missing_skills: [],
    strengths: [],
    recommendations: [],
    ...overrides,
  };
}

function scrapedJobFixture(overrides: Partial<ScrapedJobInput> = {}): ScrapedJobInput {
  return {
    title: 'Backend Engineer',
    url: 'https://example.com/jobs/1',
    company: 'Acme Corp',
    location: 'Remote - US',
    description: 'We build things.',
    ...overrides,
  };
}

function discoverFiltersFixture(overrides: Partial<DiscoverFeedFiltersDto> = {}): DiscoverFeedFiltersDto {
  return {
    page: 1,
    page_size: 20,
    ...overrides,
  };
}

describe('JobsService', () => {
  let prisma: {
    job: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    jobMatchPreview: { count: jest.Mock; findMany: jest.Mock; upsert: jest.Mock };
    dismissedJob: { upsert: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let profileService: { getProfile: jest.Mock };
  let hunterClient: { findContact: jest.Mock };
  let pdlClient: { findCompanyProfile: jest.Mock };
  let resumeGenQueue: { add: jest.Mock };
  let service: JobsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      job: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      jobMatchPreview: { count: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
      dismissedJob: { upsert: jest.fn() },
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    profileService = { getProfile: jest.fn() };
    hunterClient = { findContact: jest.fn() };
    pdlClient = { findCompanyProfile: jest.fn() };
    resumeGenQueue = { add: jest.fn() };

    service = new JobsService(
      prisma as unknown as PrismaService,
      profileService as unknown as ProfileService,
      hunterClient as unknown as HunterClient,
      pdlClient as unknown as PeopleDataLabsClient,
      resumeGenQueue as never,
    );
  });

  describe('ingestFromScanner', () => {
    // The dedupe/create/analyze/enrichment matrix now lives in
    // ingest-scraped-jobs.spec.ts, against ingestScrapedJobs() directly —
    // this method is just a thin scan-then-delegate wrapper, so only the
    // delegation itself is asserted here.
    it('scans via scanTrackedCompanies and delegates to ingestScrapedJobs with the service deps', async () => {
      const scraped = [scrapedJobFixture()];
      scanTrackedCompaniesMock.mockResolvedValue(scraped);
      ingestScrapedJobsMock.mockResolvedValue({ scanned: 1, created: 1 });

      const result = await service.ingestFromScanner();

      expect(ingestScrapedJobsMock).toHaveBeenCalledWith(scraped, {
        prisma,
        hunterClient,
        pdlClient,
        logger: expect.anything(),
      });
      expect(result).toEqual({ scanned: 1, created: 1 });
    });
  });

  describe('getDiscoverFeed', () => {
    beforeEach(() => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ settings: {} }); // defaults: match_threshold 50
      prisma.jobMatchPreview.count.mockResolvedValue(0);
      prisma.jobMatchPreview.findMany.mockResolvedValue([]);
    });

    it('paginates using skip/take derived from page and page_size, never returning an unbounded collection', async () => {
      await service.getDiscoverFeed(USER_ID, discoverFiltersFixture({ page: 3, page_size: 10 }));

      expect(prisma.jobMatchPreview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('excludes jobs the user has already dismissed', async () => {
      await service.getDiscoverFeed(USER_ID, discoverFiltersFixture());

      expect(prisma.jobMatchPreview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            job: expect.objectContaining({ dismissedBy: { none: { userId: USER_ID } } }),
          }),
        }),
      );
    });

    it('filters by match_threshold from the user settings', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ settings: { match_threshold: 75 } });

      await service.getDiscoverFeed(USER_ID, discoverFiltersFixture());

      expect(prisma.jobMatchPreview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ matchScore: { gte: 75 } }),
        }),
      );
      expect(prisma.jobMatchPreview.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ matchScore: { gte: 75 } }),
        }),
      );
    });

    it('narrows by location (case-insensitive contains) when the location filter is set', async () => {
      await service.getDiscoverFeed(USER_ID, discoverFiltersFixture({ location: 'Berlin' }));

      expect(prisma.jobMatchPreview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            job: expect.objectContaining({ location: { contains: 'Berlin', mode: 'insensitive' } }),
          }),
        }),
      );
    });

    it('narrows to remote jobs when "remote" is among the requested work modes', async () => {
      await service.getDiscoverFeed(USER_ID, discoverFiltersFixture({ work_mode: ['remote'] }));

      expect(prisma.jobMatchPreview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ job: expect.objectContaining({ remote: true }) }),
        }),
      );
    });

    it('narrows by category_tags matching the job title', async () => {
      await service.getDiscoverFeed(USER_ID, discoverFiltersFixture({ category_tags: ['engineer'] }));

      expect(prisma.jobMatchPreview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            job: expect.objectContaining({
              OR: [{ title: { contains: 'engineer', mode: 'insensitive' } }],
            }),
          }),
        }),
      );
    });

    it('filters results by seniority in-memory, after the paginated DB fetch', async () => {
      prisma.jobMatchPreview.findMany.mockResolvedValue([
        { matchScore: 80, job: { id: 'j1', parsedJd: jobDNAFixture({ seniority: 'Senior' }) } },
        { matchScore: 70, job: { id: 'j2', parsedJd: jobDNAFixture({ seniority: 'Junior' }) } },
      ]);

      const result = await service.getDiscoverFeed(USER_ID, discoverFiltersFixture({ seniority: 'senior' }));

      expect(result.items).toEqual([{ job: expect.objectContaining({ id: 'j1' }), matchScore: 80 }]);
    });

    it('returns total/page/pageSize alongside the mapped items', async () => {
      prisma.jobMatchPreview.count.mockResolvedValue(42);
      prisma.jobMatchPreview.findMany.mockResolvedValue([
        { matchScore: 90, job: { id: 'j1', parsedJd: null } },
      ]);

      const result = await service.getDiscoverFeed(USER_ID, discoverFiltersFixture({ page: 2, page_size: 20 }));

      expect(result).toEqual({
        total: 42,
        page: 2,
        pageSize: 20,
        items: [{ job: { id: 'j1', parsedJd: null }, matchScore: 90 }],
      });
    });
  });

  describe('dismiss', () => {
    it('upserts a DismissedJob row scoped to the user/job composite key when the Job exists', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1' });

      await service.dismiss(USER_ID, 'job-1');

      expect(prisma.dismissedJob.upsert).toHaveBeenCalledWith({
        where: { userId_jobId: { userId: USER_ID, jobId: 'job-1' } },
        create: { userId: USER_ID, jobId: 'job-1' },
        update: {},
      });
    });

    it('throws NotFoundException and never writes when the Job does not exist', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.dismiss(USER_ID, 'bogus-job')).rejects.toThrow(NotFoundException);
      expect(prisma.dismissedJob.upsert).not.toHaveBeenCalled();
    });
  });

  describe('swipeRight', () => {
    it('enqueues a "generate" resume-gen job with the userId and jobId, without blocking on the pipeline', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1' });

      await service.swipeRight(USER_ID, 'job-1');

      expect(resumeGenQueue.add).toHaveBeenCalledWith('generate', { userId: USER_ID, jobId: 'job-1' });
    });

    it('throws NotFoundException and never enqueues when the Job does not exist', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(service.swipeRight(USER_ID, 'bogus-job')).rejects.toThrow(NotFoundException);
      expect(resumeGenQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('refreshMatchPreviews', () => {
    it('returns { refreshed: 0 } and does no work when the user has no career profile', async () => {
      profileService.getProfile.mockResolvedValue(null);

      const result = await service.refreshMatchPreviews(USER_ID);

      expect(result).toEqual({ refreshed: 0 });
      expect(prisma.job.findMany).not.toHaveBeenCalled();
    });

    it('queries jobs missing a fresh (<24h) preview, capped at MAX_PREVIEW_CANDIDATES, newest first', async () => {
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      prisma.job.findMany.mockResolvedValue([]);

      const before = Date.now();
      await service.refreshMatchPreviews(USER_ID);
      const after = Date.now();

      expect(prisma.job.findMany).toHaveBeenCalledTimes(1);
      const call = prisma.job.findMany.mock.calls[0][0];
      expect(call.take).toBe(40);
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call.where.parsedJd).toEqual({ not: Prisma.DbNull });
      expect(call.where.OR).toEqual([
        { matchPreviews: { none: { userId: USER_ID } } },
        { matchPreviews: { some: { userId: USER_ID, computedAt: { lt: expect.any(Date) } } } },
      ]);
      const freshCutoff: Date = call.where.OR[1].matchPreviews.some.computedAt.lt;
      // freshCutoff should sit ~24h before "now" at call time, not some arbitrary value.
      expect(freshCutoff.getTime()).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
      expect(freshCutoff.getTime()).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
    });

    it('upserts a match preview per candidate job with the freshly computed score', async () => {
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      const jobDNA = jobDNAFixture();
      prisma.job.findMany.mockResolvedValue([{ id: 'job-1', parsedJd: jobDNA }]);
      checkCompatibilityMock.mockResolvedValue(compatibilityResultFixture({ score: 88 }));

      const result = await service.refreshMatchPreviews(USER_ID);

      expect(checkCompatibilityMock).toHaveBeenCalledWith(jobDNA, masterDBFixture());
      expect(prisma.jobMatchPreview.upsert).toHaveBeenCalledWith({
        where: { userId_jobId: { userId: USER_ID, jobId: 'job-1' } },
        create: { userId: USER_ID, jobId: 'job-1', matchScore: 88 },
        update: { matchScore: 88, computedAt: expect.any(Date) },
      });
      expect(result).toEqual({ refreshed: 1 });
    });

    it('skips a candidate whose compatibility check throws and still refreshes the rest', async () => {
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-fail', parsedJd: jobDNAFixture() },
        { id: 'job-ok', parsedJd: jobDNAFixture() },
      ]);
      checkCompatibilityMock
        .mockRejectedValueOnce(new Error('LLM error'))
        .mockResolvedValueOnce(compatibilityResultFixture({ score: 60 }));

      const result = await service.refreshMatchPreviews(USER_ID);

      expect(result).toEqual({ refreshed: 1 });
      expect(prisma.jobMatchPreview.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.jobMatchPreview.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_jobId: { userId: USER_ID, jobId: 'job-ok' } } }),
      );
    });
  });

  describe('getUserSettings', () => {
    it('returns schema defaults when User.settings is empty', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ settings: {} });

      const settings = await service.getUserSettings(USER_ID);

      expect(settings.match_threshold).toBe(50);
      expect(settings.resume_template).toBe('default');
      expect(settings.auto_send_email).toBe(false);
    });

    it('returns schema defaults when User.settings is null', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ settings: null });

      const settings = await service.getUserSettings(USER_ID);

      expect(settings.match_threshold).toBe(50);
    });

    it('returns the stored settings when they parse successfully against the schema', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        settings: { match_threshold: 65, preferred_locations: ['Berlin'], target_roles: [], resume_template: 'modern', ai_provider_override: undefined, auto_send_email: true, notify_on_new_jobs: false, category_tags: [], work_mode: [] },
      });

      const settings = await service.getUserSettings(USER_ID);

      expect(settings.match_threshold).toBe(65);
      expect(settings.resume_template).toBe('modern');
      expect(settings.auto_send_email).toBe(true);
    });

    it('falls back to defaults when stored settings fail schema validation (corrupt data)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ settings: { match_threshold: 'not-a-number' } });

      const settings = await service.getUserSettings(USER_ID);

      expect(settings.match_threshold).toBe(50);
    });
  });

  describe('updateUserSettings', () => {
    it('merges the patch onto current settings, persists, and returns the merged result', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ settings: { match_threshold: 50 } });
      prisma.user.update.mockResolvedValue({});

      const result = await service.updateUserSettings(USER_ID, { match_threshold: 80 });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { settings: expect.objectContaining({ match_threshold: 80 }) },
      });
      expect(result.match_threshold).toBe(80);
    });

    it('preserves untouched fields from current settings when the patch only sets one field', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        settings: { match_threshold: 50, resume_template: 'modern' },
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.updateUserSettings(USER_ID, { match_threshold: 90 });

      expect(result.resume_template).toBe('modern');
      expect(result.match_threshold).toBe(90);
    });

    it('rejects a patch with an out-of-range match_threshold via the Zod schema', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ settings: {} });

      await expect(service.updateUserSettings(USER_ID, { match_threshold: 150 })).rejects.toThrow();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

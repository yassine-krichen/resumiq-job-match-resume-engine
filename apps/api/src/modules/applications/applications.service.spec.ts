import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { ResumeService } from '../resume/resume.service';
import {
  analyzeJob,
  checkCompatibility,
  critiqueAndRevise,
  generateEmail,
  selectAndDraft,
} from '@resumiq/ai-bridge';
import type { AISelection, JobDNA, MasterDB } from '@resumiq/ai-bridge';
import type { CreateJobDto } from '@resumiq/schemas';
import { buildManualJobDedupeKey } from '../../common/jobs/dedupe-key';

jest.mock('@resumiq/ai-bridge', () => ({
  analyzeJob: jest.fn(),
  checkCompatibility: jest.fn(),
  selectAndDraft: jest.fn(),
  critiqueAndRevise: jest.fn(),
  generateEmail: jest.fn(),
}));

const analyzeJobMock = analyzeJob as jest.Mock;
const checkCompatibilityMock = checkCompatibility as jest.Mock;
const selectAndDraftMock = selectAndDraft as jest.Mock;
const critiqueAndReviseMock = critiqueAndRevise as jest.Mock;
const generateEmailMock = generateEmail as jest.Mock;

const OTHER_USER = 'user-attacker';
const OWNER = 'user-owner';
const APP_ID = 'app-1';

function jobDNAFixture(): JobDNA {
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

function selectionFixture(): AISelection {
  return {
    reasoning: 'r',
    section_order: ['experience'],
    experience: [],
    projects: [],
    skills: { languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] },
    certifications: [],
    awards: [],
  };
}

function createJobDtoFixture(overrides: Partial<CreateJobDto> = {}): CreateJobDto {
  return {
    raw_jd: 'x'.repeat(60),
    pages: 2,
    ...overrides,
  };
}

describe('ApplicationsService', () => {
  let prisma: {
    job: { upsert: jest.Mock; findUniqueOrThrow: jest.Mock };
    application: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
  };
  let profileService: { getProfile: jest.Mock };
  let resumeService: { renderPreview: jest.Mock; renderFinal: jest.Mock };
  let service: ApplicationsService;
  let onProgress: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      job: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
      application: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    };
    profileService = { getProfile: jest.fn() };
    resumeService = { renderPreview: jest.fn(), renderFinal: jest.fn() };
    service = new ApplicationsService(
      prisma as unknown as PrismaService,
      profileService as unknown as ProfileService,
      resumeService as unknown as ResumeService,
    );
    onProgress = jest.fn();
  });

  describe('analyzeAndDraft', () => {
    it('throws BadRequestException when the user has no career profile yet', async () => {
      profileService.getProfile.mockResolvedValue(null);

      await expect(
        service.analyzeAndDraft(OWNER, createJobDtoFixture(), onProgress),
      ).rejects.toThrow(BadRequestException);

      expect(analyzeJobMock).not.toHaveBeenCalled();
    });

    it('persists a gap report and skips resume drafting when the compatibility score is below threshold', async () => {
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      analyzeJobMock.mockResolvedValue(jobDNAFixture());
      prisma.job.upsert.mockResolvedValue({ id: 'job-1' });
      checkCompatibilityMock.mockResolvedValue({
        compatible: false,
        score: 20,
        blockers: ['Missing TypeScript'],
        warnings: [],
        suggestions: [],
        reasons: ['No TypeScript experience found'],
        missing_skills: [{ skill: 'TypeScript', priority: 'mandatory', suggested_resources: ['course'] }],
        strengths: [],
        recommendations: ['Build a TypeScript project'],
      });
      prisma.application.create.mockResolvedValue({ id: APP_ID });

      const result = await service.analyzeAndDraft(OWNER, createJobDtoFixture(), onProgress);

      expect(selectAndDraftMock).not.toHaveBeenCalled();
      expect(critiqueAndReviseMock).not.toHaveBeenCalled();
      expect(prisma.application.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: OWNER, status: 'gap_reported', matchScore: 20 }),
        }),
      );
      expect(result).toEqual({
        applicationId: APP_ID,
        matchScore: 20,
        reasons: ['No TypeScript experience found'],
        gapReport: {
          match_score: 20,
          missing_skills: [{ skill: 'TypeScript', priority: 'mandatory', suggested_resources: ['course'] }],
          strengths: [],
          recommendations: ['Build a TypeScript project'],
        },
      });
    });

    it('drafts and critiques a resume selection when the compatibility score meets threshold', async () => {
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      analyzeJobMock.mockResolvedValue(jobDNAFixture());
      prisma.job.upsert.mockResolvedValue({ id: 'job-1' });
      checkCompatibilityMock.mockResolvedValue({
        compatible: true,
        score: 75,
        blockers: [],
        warnings: [],
        suggestions: [],
        reasons: ['Strong match'],
        missing_skills: [],
        strengths: ['Strong TS background'],
        recommendations: [],
      });
      const draft = selectionFixture();
      const critiqued = { ...selectionFixture(), reasoning: 'revised' };
      selectAndDraftMock.mockResolvedValue(draft);
      critiqueAndReviseMock.mockResolvedValue(critiqued);
      prisma.application.create.mockResolvedValue({ id: APP_ID });

      const result = await service.analyzeAndDraft(OWNER, createJobDtoFixture(), onProgress);

      expect(selectAndDraftMock).toHaveBeenCalledWith(jobDNAFixture(), masterDBFixture(), 2);
      expect(critiqueAndReviseMock).toHaveBeenCalledWith(draft, jobDNAFixture(), masterDBFixture());
      expect(prisma.application.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resumeSelection: critiqued, matchScore: 75 }),
        }),
      );
      expect(result).toEqual({
        applicationId: APP_ID,
        matchScore: 75,
        reasons: ['Strong match'],
        selection: critiqued,
      });
    });

    it('reports progress at each step of the analyze pipeline', async () => {
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      analyzeJobMock.mockResolvedValue(jobDNAFixture());
      prisma.job.upsert.mockResolvedValue({ id: 'job-1' });
      checkCompatibilityMock.mockResolvedValue({
        compatible: false,
        score: 10,
        blockers: [],
        warnings: [],
        suggestions: [],
        reasons: [],
        missing_skills: [],
        strengths: [],
        recommendations: [],
      });
      prisma.application.create.mockResolvedValue({ id: APP_ID });

      await service.analyzeAndDraft(OWNER, createJobDtoFixture(), onProgress);

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('scopes the upsert dedupeKey to this user + content, never the scraper\'s shared company/title/location namespace', async () => {
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      analyzeJobMock.mockResolvedValue(jobDNAFixture());
      prisma.job.upsert.mockResolvedValue({ id: 'job-1' });
      checkCompatibilityMock.mockResolvedValue({
        compatible: false,
        score: 10,
        blockers: [],
        warnings: [],
        suggestions: [],
        reasons: [],
        missing_skills: [],
        strengths: [],
        recommendations: [],
      });
      prisma.application.create.mockResolvedValue({ id: APP_ID });
      const dto = createJobDtoFixture({
        company_name: 'Stripe',
        title: 'Backend Engineer',
        location: 'Remote',
      });

      await service.analyzeAndDraft(OWNER, dto, onProgress);

      const expectedKey = buildManualJobDedupeKey(
        OWNER,
        'Stripe',
        'Backend Engineer',
        'Remote',
        dto.raw_jd,
      );
      expect(prisma.job.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dedupeKey: expectedKey },
          create: expect.objectContaining({ dedupeKey: expectedKey }),
        }),
      );
      // The pure content-based key the scraper's ingestion pipeline uses for
      // this same company/title/location must never appear anywhere here.
      expect(expectedKey).not.toBe('stripe|backend engineer|remote');
    });

    it('produces a different dedupeKey for two different users submitting the identical company/title/location/JD, preventing cross-user Job row collision', async () => {
      const dto = createJobDtoFixture({
        company_name: 'Stripe',
        title: 'Backend Engineer',
        location: 'Remote',
        raw_jd: 'identical job description text',
      });

      const keyForOwner = buildManualJobDedupeKey(
        OWNER,
        dto.company_name!,
        dto.title!,
        dto.location,
        dto.raw_jd,
      );
      const keyForAttacker = buildManualJobDedupeKey(
        OTHER_USER,
        dto.company_name!,
        dto.title!,
        dto.location,
        dto.raw_jd,
      );

      expect(keyForOwner).not.toBe(keyForAttacker);
    });

    it('produces a different dedupeKey for the same user submitting genuinely different JD text for the same company/title/location', async () => {
      const keyA = buildManualJobDedupeKey(OWNER, 'Stripe', 'Backend Engineer', 'Remote', 'JD text A');
      const keyB = buildManualJobDedupeKey(OWNER, 'Stripe', 'Backend Engineer', 'Remote', 'JD text B');

      expect(keyA).not.toBe(keyB);
    });
  });

  describe('draftForExistingJob', () => {
    const JOB_ID = 'job-scraped-1';

    it('loads the Job by id, reuses its already-computed parsedJd, and delegates to the same drafting logic as analyzeAndDraft', async () => {
      prisma.job.findUniqueOrThrow.mockResolvedValue({ id: JOB_ID, parsedJd: jobDNAFixture() });
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      checkCompatibilityMock.mockResolvedValue({
        compatible: true,
        score: 80,
        blockers: [],
        warnings: [],
        suggestions: [],
        reasons: ['Strong match'],
        missing_skills: [],
        strengths: [],
        recommendations: [],
      });
      const draft = selectionFixture();
      selectAndDraftMock.mockResolvedValue(draft);
      critiqueAndReviseMock.mockResolvedValue(draft);
      prisma.application.create.mockResolvedValue({ id: APP_ID });

      const result = await service.draftForExistingJob(OWNER, JOB_ID, onProgress);

      expect(prisma.job.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: JOB_ID } });
      // No re-analysis of the JD — parsedJd was already computed at ingestion time.
      expect(analyzeJobMock).not.toHaveBeenCalled();
      expect(checkCompatibilityMock).toHaveBeenCalledWith(jobDNAFixture(), masterDBFixture());
      expect(prisma.application.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: OWNER, jobId: JOB_ID, matchScore: 80 }),
        }),
      );
      expect(result).toEqual({
        applicationId: APP_ID,
        matchScore: 80,
        reasons: ['Strong match'],
        selection: draft,
      });
    });

    it('throws BadRequestException when the user has no career profile yet', async () => {
      prisma.job.findUniqueOrThrow.mockResolvedValue({ id: JOB_ID, parsedJd: jobDNAFixture() });
      profileService.getProfile.mockResolvedValue(null);

      await expect(service.draftForExistingJob(OWNER, JOB_ID, onProgress)).rejects.toThrow(
        BadRequestException,
      );
      expect(checkCompatibilityMock).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the Job has no parsedJd (analyzeJob failed during scraper ingestion)', async () => {
      prisma.job.findUniqueOrThrow.mockResolvedValue({ id: JOB_ID, parsedJd: null });
      profileService.getProfile.mockResolvedValue(masterDBFixture());

      await expect(service.draftForExistingJob(OWNER, JOB_ID, onProgress)).rejects.toThrow(
        BadRequestException,
      );
      expect(checkCompatibilityMock).not.toHaveBeenCalled();
    });
  });

  describe('ownership checks — a user cannot read or edit another user\'s application', () => {
    it('updateResumeSelection throws NotFoundException and never writes when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.updateResumeSelection(OTHER_USER, APP_ID, selectionFixture() as never),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.application.findFirst).toHaveBeenCalledWith({
        where: { id: APP_ID, userId: OTHER_USER },
      });
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('updateGapReport throws NotFoundException and never writes when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.updateGapReport(OTHER_USER, APP_ID, {
          match_score: 10,
          missing_skills: [],
          strengths: [],
          recommendations: [],
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('updateEmailDraft throws NotFoundException and never writes when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.updateEmailDraft(OTHER_USER, APP_ID, { subject: 's', body: 'b' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('confirm throws NotFoundException and never writes when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(service.confirm(OTHER_USER, APP_ID)).rejects.toThrow(NotFoundException);
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it("confirm flips status to 'ready', distinct from 'email_drafted', for the owning user", async () => {
      prisma.application.findFirst.mockResolvedValue({ id: APP_ID, userId: OWNER });
      prisma.application.update.mockResolvedValue({ id: APP_ID, status: 'ready' });

      await service.confirm(OWNER, APP_ID);

      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: APP_ID },
        data: { status: 'ready' },
      });
    });

    it('getById throws NotFoundException (joined with job) when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(service.getById(OTHER_USER, APP_ID)).rejects.toThrow(NotFoundException);
      expect(prisma.application.findFirst).toHaveBeenCalledWith({
        where: { id: APP_ID, userId: OTHER_USER },
        include: { job: true },
      });
    });

    it('getResumePdfPath throws NotFoundException when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(service.getResumePdfPath(OTHER_USER, APP_ID)).rejects.toThrow(NotFoundException);
    });

    it('getResumePdfPath throws NotFoundException when the owner exists but no resume has been rendered yet', async () => {
      prisma.application.findFirst.mockResolvedValue({ id: APP_ID, userId: OWNER, resumePdfPath: null });

      await expect(service.getResumePdfPath(OWNER, APP_ID)).rejects.toThrow(NotFoundException);
    });

    it('getResumePdfPath returns the stored path for the owning user', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: APP_ID,
        userId: OWNER,
        resumePdfPath: `${OWNER}/${APP_ID}/resume.pdf`,
      });

      const path = await service.getResumePdfPath(OWNER, APP_ID);

      expect(path).toBe(`${OWNER}/${APP_ID}/resume.pdf`);
    });

    it('renderPreview throws NotFoundException when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.renderPreview(OTHER_USER, APP_ID, selectionFixture()),
      ).rejects.toThrow(NotFoundException);
      expect(resumeService.renderPreview).not.toHaveBeenCalled();
    });

    it('finalizeAndDraftEmail throws NotFoundException when the application belongs to a different user', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.finalizeAndDraftEmail(OTHER_USER, APP_ID, onProgress),
      ).rejects.toThrow(NotFoundException);
      expect(resumeService.renderFinal).not.toHaveBeenCalled();
    });
  });

  describe('renderPreview (owner)', () => {
    it('throws BadRequestException when the owner has no career profile', async () => {
      prisma.application.findFirst.mockResolvedValue({ id: APP_ID, userId: OWNER });
      profileService.getProfile.mockResolvedValue(null);

      await expect(service.renderPreview(OWNER, APP_ID, selectionFixture())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('renders the given selection against the owner profile without persisting', async () => {
      prisma.application.findFirst.mockResolvedValue({ id: APP_ID, userId: OWNER });
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      const renderResult = { pdf: Buffer.from('x'), pageCount: 1, source: 'DOC' };
      resumeService.renderPreview.mockResolvedValue(renderResult);

      const result = await service.renderPreview(OWNER, APP_ID, selectionFixture());

      expect(result).toBe(renderResult);
      expect(resumeService.renderPreview).toHaveBeenCalledWith(
        selectionFixture(),
        masterDBFixture(),
        'default',
      );
    });
  });

  describe('finalizeAndDraftEmail (owner)', () => {
    it('throws BadRequestException when there is no resume selection to render', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: APP_ID,
        userId: OWNER,
        resumeSelection: null,
        job: { parsedJd: jobDNAFixture(), companyInfo: null },
      });

      await expect(service.finalizeAndDraftEmail(OWNER, APP_ID, onProgress)).rejects.toThrow(
        BadRequestException,
      );
      expect(resumeService.renderFinal).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the owner has no career profile', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: APP_ID,
        userId: OWNER,
        resumeSelection: selectionFixture(),
        job: { parsedJd: jobDNAFixture(), companyInfo: null },
      });
      profileService.getProfile.mockResolvedValue(null);

      await expect(service.finalizeAndDraftEmail(OWNER, APP_ID, onProgress)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('renders the PDF, persists it, then drafts and persists a cold email in sequence', async () => {
      const selection = selectionFixture();
      prisma.application.findFirst.mockResolvedValue({
        id: APP_ID,
        userId: OWNER,
        resumeSelection: selection,
        job: { parsedJd: jobDNAFixture(), companyInfo: { raw: 'We build fintech infra' } },
      });
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      resumeService.renderFinal.mockResolvedValue({
        pdfPath: `${OWNER}/${APP_ID}/resume.pdf`,
        pageCount: 1,
        renderedWith: 'latex',
        source: 'TEX SOURCE',
      });
      const emailDraft = { subject: 'Hello', body: 'Body' };
      generateEmailMock.mockResolvedValue(emailDraft);
      prisma.application.update.mockResolvedValue({});

      const result = await service.finalizeAndDraftEmail(OWNER, APP_ID, onProgress);

      // First update persists the render; second persists the email — order matters
      // because email drafting reads the same application state, not a race.
      expect(prisma.application.update).toHaveBeenNthCalledWith(1, {
        where: { id: APP_ID },
        data: {
          resumeSource: 'TEX SOURCE',
          renderedWith: 'latex',
          resumePdfPath: `${OWNER}/${APP_ID}/resume.pdf`,
          status: 'resume_drafted',
        },
      });
      expect(generateEmailMock).toHaveBeenCalledWith(
        jobDNAFixture(),
        'We build fintech infra',
        selection,
      );
      expect(prisma.application.update).toHaveBeenNthCalledWith(2, {
        where: { id: APP_ID },
        data: { emailDraft, status: 'email_drafted' },
      });
      expect(result).toEqual({
        applicationId: APP_ID,
        pdfPath: `${OWNER}/${APP_ID}/resume.pdf`,
        emailDraft,
      });
    });

    it('drafts the email with an empty company_info string when the job has none on file', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: APP_ID,
        userId: OWNER,
        resumeSelection: selectionFixture(),
        job: { parsedJd: jobDNAFixture(), companyInfo: null },
      });
      profileService.getProfile.mockResolvedValue(masterDBFixture());
      resumeService.renderFinal.mockResolvedValue({
        pdfPath: 'p',
        pageCount: 1,
        renderedWith: 'latex',
        source: 's',
      });
      generateEmailMock.mockResolvedValue({ subject: 's', body: 'b' });

      await service.finalizeAndDraftEmail(OWNER, APP_ID, onProgress);

      expect(generateEmailMock).toHaveBeenCalledWith(jobDNAFixture(), '', selectionFixture());
    });
  });
});

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  analyzeJob,
  checkCompatibility,
  critiqueAndRevise,
  generateEmail,
  selectAndDraft,
} from '@resumiq/ai-bridge';
import type { AISelection, JobDNA } from '@resumiq/ai-bridge';
import { UpdateResumeSelectionSchema } from '@resumiq/schemas';
import type {
  CreateJobDto,
  UpdateEmailDraftDto,
  UpdateGapReportDto,
  UpdateResumeSelectionDto,
} from '@resumiq/schemas';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { ResumeService } from '../resume/resume.service';

type Json = Prisma.InputJsonValue;

const DEFAULT_MATCH_THRESHOLD = 50;
const DEFAULT_TEMPLATE_ID = 'default';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileService: ProfileService,
    private readonly resumeService: ResumeService,
  ) {}

  /**
   * Runs the analyze leg: creates the Job row, analyzes the JD, scores
   * compatibility, and either persists a gap report (below threshold) or
   * drafts + critiques a resume selection (at/above threshold).
   */
  async analyzeAndDraft(
    userId: string,
    dto: CreateJobDto,
    onProgress: (step: string) => void,
  ) {
    const db = await this.profileService.getProfile(userId);
    if (!db) {
      throw new BadRequestException(
        'Career profile required before analyzing a job — complete onboarding first',
      );
    }

    onProgress('Extracting job details...');
    const jobDNA: JobDNA = await analyzeJob(dto.raw_jd, dto.company_info ?? '');

    onProgress('Comparing against your Career Inventory...');
    // Run before persisting the Job row: if checkCompatibility throws, no
    // Job row is created that no Application would ever reference.
    const compat = await checkCompatibility(jobDNA, db);

    const job = await this.prisma.job.create({
      data: {
        source: 'manual',
        sourceUrl: dto.source_url,
        title: dto.title ?? jobDNA.job_title,
        companyName: dto.company_name ?? 'Unknown Company',
        companyInfo: dto.company_info ? ({ raw: dto.company_info } as Json) : undefined,
        rawJd: dto.raw_jd,
        parsedJd: jobDNA as unknown as Json,
        location: dto.location,
        remote: dto.remote ?? false,
        salaryRange: dto.salary_range,
      },
    });

    const threshold = DEFAULT_MATCH_THRESHOLD;

    if (compat.score < threshold) {
      onProgress('Building gap report...');
      const application = await this.prisma.application.create({
        data: {
          userId,
          jobId: job.id,
          matchScore: compat.score,
          matchReasons: compat.reasons as unknown as Json,
          status: 'gap_reported',
          gapReport: {
            match_score: compat.score,
            missing_skills: compat.missing_skills,
            strengths: compat.strengths,
            recommendations: compat.recommendations,
          } as unknown as Json,
        },
      });

      return {
        applicationId: application.id,
        matchScore: compat.score,
        reasons: compat.reasons,
        gapReport: {
          match_score: compat.score,
          missing_skills: compat.missing_skills,
          strengths: compat.strengths,
          recommendations: compat.recommendations,
        },
      };
    }

    onProgress('Selecting best content from your Inventory for this role...');
    const draft = await selectAndDraft(jobDNA, db, dto.pages);

    onProgress('Drafting tailored resume bullets...');
    const rawSelection = await critiqueAndRevise(draft, jobDNA, db);

    // The LLM's JSON output is parsed with no runtime shape guarantees —
    // validate it through the same schema the user-edit path enforces
    // before it's persisted and later rendered to PDF.
    const parsedSelection = UpdateResumeSelectionSchema.safeParse(rawSelection);
    if (!parsedSelection.success) {
      throw new BadRequestException(
        'AI generated an invalid resume selection — please retry the analysis',
      );
    }
    const selection: AISelection = parsedSelection.data;

    const application = await this.prisma.application.create({
      data: {
        userId,
        jobId: job.id,
        matchScore: compat.score,
        matchReasons: compat.reasons as unknown as Json,
        status: 'gap_reported', // no resume rendered yet — flips to resume_drafted at finalize
        resumeSelection: selection as unknown as Json,
      },
    });

    return {
      applicationId: application.id,
      matchScore: compat.score,
      reasons: compat.reasons,
      selection,
    };
  }

  async updateResumeSelection(
    userId: string,
    applicationId: string,
    selection: UpdateResumeSelectionDto,
  ) {
    await this.findOwned(userId, applicationId);
    return this.prisma.application.update({
      where: { id: applicationId },
      data: { resumeSelection: selection as unknown as Json },
    });
  }

  async updateGapReport(userId: string, applicationId: string, gapReport: UpdateGapReportDto) {
    await this.findOwned(userId, applicationId);
    return this.prisma.application.update({
      where: { id: applicationId },
      data: { gapReport: gapReport as unknown as Json },
    });
  }

  async renderPreview(userId: string, applicationId: string, selection: AISelection) {
    await this.findOwned(userId, applicationId);
    const db = await this.profileService.getProfile(userId);
    if (!db) throw new BadRequestException('Career profile not found');

    return this.resumeService.renderPreview(selection, db, DEFAULT_TEMPLATE_ID);
  }

  /**
   * Runs the finalize leg: renders the confirmed selection to PDF, persists it,
   * then drafts a cold email off the same job/company context.
   */
  async finalizeAndDraftEmail(
    userId: string,
    applicationId: string,
    onProgress: (step: string) => void,
  ) {
    const application = await this.findOwnedWithJob(userId, applicationId);
    if (!application.resumeSelection) {
      throw new BadRequestException('No resume selection to render — run analyze first');
    }

    const db = await this.profileService.getProfile(userId);
    if (!db) throw new BadRequestException('Career profile not found');

    const selection = application.resumeSelection as unknown as AISelection;

    onProgress('Rendering PDF...');
    const { pdfPath, renderedWith, source } = await this.resumeService.renderFinal(
      applicationId,
      userId,
      selection,
      db,
      DEFAULT_TEMPLATE_ID,
    );

    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        resumeSource: source,
        renderedWith,
        resumePdfPath: pdfPath,
        status: 'resume_drafted',
      },
    });

    onProgress("Drafting cold email in company's tone & values...");
    const jobDNA = application.job.parsedJd as unknown as JobDNA;
    const companyInfo = (application.job.companyInfo as { raw?: string } | null)?.raw ?? '';
    const emailDraft = await generateEmail(jobDNA, companyInfo, selection);

    await this.prisma.application.update({
      where: { id: applicationId },
      data: { emailDraft: emailDraft as unknown as Json, status: 'email_drafted' },
    });

    return { applicationId, pdfPath, emailDraft };
  }

  async updateEmailDraft(userId: string, applicationId: string, draft: UpdateEmailDraftDto) {
    await this.findOwned(userId, applicationId);
    return this.prisma.application.update({
      where: { id: applicationId },
      data: { emailDraft: draft as unknown as Json },
    });
  }

  /**
   * Flips status to 'ready' — the user's explicit confirmation that the
   * resume + email draft are final. Distinct from 'email_drafted' (drafted,
   * awaiting review) so the review-gate step is a real persisted state, not
   * just client-side. Never sends the email — out of scope.
   */
  async confirm(userId: string, applicationId: string) {
    await this.findOwned(userId, applicationId);
    return this.prisma.application.update({
      where: { id: applicationId },
      data: { status: 'ready' },
    });
  }

  async getById(userId: string, applicationId: string) {
    return this.findOwnedWithJob(userId, applicationId);
  }

  async getResumePdfPath(userId: string, applicationId: string): Promise<string> {
    const application = await this.findOwned(userId, applicationId);
    if (!application.resumePdfPath) {
      throw new NotFoundException('Resume not yet rendered for this application');
    }
    return application.resumePdfPath;
  }

  /** Ownership check — never trust a client-supplied userId, always scope by session user. */
  private async findOwned(userId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, userId },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  /** Same ownership check, with the related Job row joined in. */
  private async findOwnedWithJob(userId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, userId },
      include: { job: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }
}

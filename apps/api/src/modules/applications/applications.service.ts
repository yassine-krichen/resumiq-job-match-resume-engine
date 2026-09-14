import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  analyzeJob,
  checkCompatibility,
  critiqueAndRevise,
  generateBehavioralInterviewPrep,
  generateEmail,
  generateInterviewIntakeQuestions,
  generateTechnicalInterviewPrep,
  parseJobIntake,
  selectAndDraft,
} from '@resumiq/ai-bridge';
import type {
  AISelection,
  CompatibilityResult,
  EmailDraft,
  GapReport,
  InterviewIntakeQuestions,
  JobDNA,
} from '@resumiq/ai-bridge';
import {
  coerceToStringArray,
  CompatibilityResultSchema,
  InterviewIntakeQuestionsSchema,
  InterviewPrepReportSchema,
  JobDNASchema,
  JobIntakeResultSchema,
  UpdateEmailDraftSchema,
  UpdateResumeSelectionSchema,
} from '@resumiq/schemas';
import type {
  CreateJobDto,
  InterviewPrepIntakeAnswersDto,
  InterviewPrepReportDto,
  JobIntakeResultDto,
  ListApplicationsFiltersDto,
  UpdateEmailDraftDto,
  UpdateGapReportDto,
  UpdateResumeSelectionDto,
} from '@resumiq/schemas';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { ResumeService } from '../resume/resume.service';
import { LocalStorageService } from '../../common/storage/local-storage.service';
import { buildManualJobDedupeKey } from '../../common/jobs/dedupe-key';

type Json = Prisma.InputJsonValue;

const DEFAULT_MATCH_THRESHOLD = 50;
const DEFAULT_TEMPLATE_ID = 'default';

interface GapReportDraftResult {
  applicationId: string;
  matchScore: number;
  reasons: string[];
  gapReport: GapReport;
}

interface ResumeSelectionDraftResult {
  applicationId: string;
  matchScore: number;
  reasons: string[];
  selection: AISelection;
}

/** `draftForJob` returns one of these two shapes depending on whether the
 * compatibility score clears `DEFAULT_MATCH_THRESHOLD`. */
type DraftForJobResult = GapReportDraftResult | ResumeSelectionDraftResult;

/** Persisted shape of `Application.interviewPrep`. `intake.weak_topics` is the
 * deterministic (zero-LLM-cost) checklist derived from the job's
 * `mandatory_technical_skills`; `intake.questions` is the LLM-generated
 * dynamic question set; `intake.answers` is set once the user submits the
 * structured intake form. `report` stays null until both synthesis agents
 * have run — see `generateInterviewPrepReport`. */
export interface InterviewPrepIntakeState {
  weak_topics: string[];
  questions: InterviewIntakeQuestions;
  answers?: InterviewPrepIntakeAnswersDto;
}

export interface InterviewPrepState {
  intake: InterviewPrepIntakeState;
  report: InterviewPrepReportDto | null;
}

/**
 * Normalizes `Job.companyInfo`'s two on-disk shapes into plain text for LLM
 * prompts: the manual-paste shape (`{ raw: string }`, written by
 * `analyzeAndDraft`) and the scraper-enrichment shape (`{ profile:
 * CompanyProfile | null, contact: HunterContact | null }`, written by
 * jobs.service.ts's Hunter.io/PDL enrichment). Contact info is deliberately
 * excluded — a recruiting contact's name/email isn't useful prompt context.
 * Returns '' for null/unrecognized shapes — company info is always optional
 * prompt context, never worth throwing over.
 */
export function formatCompanyInfoForPrompt(companyInfo: unknown): string {
  if (!companyInfo || typeof companyInfo !== 'object') return '';

  const raw = (companyInfo as { raw?: unknown }).raw;
  if (typeof raw === 'string') return raw;

  const profile = (companyInfo as { profile?: unknown }).profile;
  if (profile && typeof profile === 'object') {
    const p = profile as {
      industry?: string;
      size?: string;
      founded?: number;
      summary?: string;
      tags?: string[];
    };
    const lines: string[] = [];
    if (p.summary) lines.push(p.summary);
    if (p.industry) lines.push(`Industry: ${p.industry}`);
    if (p.size) lines.push(`Size: ${p.size}`);
    if (p.founded) lines.push(`Founded: ${p.founded}`);
    if (p.tags?.length) lines.push(`Tags: ${p.tags.join(', ')}`);
    if (lines.length) return lines.join('\n');
  }

  return '';
}

/** Thin, explicit-select application shape shared by `listApplications` and
 * `getDashboardSummary`'s `recentActivity` — deliberately excludes the
 * gapReport/resumeSelection/resumeSource JSON blobs no caller of these two
 * needs. */
const APPLICATION_LIST_SELECT = {
  id: true,
  status: true,
  matchScore: true,
  createdAt: true,
  updatedAt: true,
  job: {
    select: { id: true, title: true, companyName: true, location: true },
  },
} satisfies Prisma.ApplicationSelect;

export interface ListApplicationsResult {
  total: number;
  page: number;
  pageSize: number;
  items: Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_LIST_SELECT }>[];
}

export interface DashboardSummary {
  totalApplications: number;
  avgMatchScore: number;
  resumesGenerated: number;
  gapReportsSaved: number;
  recentActivity: Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_LIST_SELECT }>[];
  // Bounded (max 5) exception to the thin-select convention above — the
  // frontend's GapReportView needs the full gapReport JSON (and other full
  // fields) for its checkbox interactivity, and 5 rows is small enough that
  // returning full rows here doesn't reintroduce the over-fetch risk the
  // thin select exists to prevent.
  savedGapReports: Prisma.ApplicationGetPayload<{ include: { job: true } }>[];
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileService: ProfileService,
    private readonly resumeService: ResumeService,
    private readonly storage: LocalStorageService,
  ) {}

  /**
   * Stateless best-effort extraction of job-posting metadata from a raw
   * paste — used to pre-fill the manual job-intake review form before
   * `analyzeAndDraft` runs. No profile lookup, no DB writes.
   */
  async extractJobIntake(rawText: string): Promise<JobIntakeResultDto> {
    const raw = await parseJobIntake(rawText);
    const parsed = JobIntakeResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException('Could not parse the pasted text — please try again.');
    }
    return parsed.data;
  }

  /**
   * Runs the analyze leg: creates the Job row, analyzes the JD, scores
   * compatibility, and either persists a gap report (below threshold) or
   * drafts + critiques a resume selection (at/above threshold).
   */
  async analyzeAndDraft(
    userId: string,
    dto: CreateJobDto,
    onProgress: (step: string) => void,
  ): Promise<DraftForJobResult> {
    const db = await this.profileService.getProfile(userId);
    if (!db) {
      throw new BadRequestException(
        'Career profile required before analyzing a job — complete onboarding first',
      );
    }

    onProgress('Extracting job details...');
    const rawJobDNA = await analyzeJob(dto.raw_jd, dto.company_info ?? '');
    const parsedJobDNA = JobDNASchema.safeParse(rawJobDNA);
    if (!parsedJobDNA.success) {
      this.logger.warn(`analyzeJob returned an invalid shape: ${parsedJobDNA.error.message}`);
      throw new BadRequestException(
        'AI generated an invalid job analysis — please retry the analysis',
      );
    }
    const jobDNA: JobDNA = parsedJobDNA.data;

    const title = dto.title ?? jobDNA.job_title;
    const companyName = dto.company_name ?? 'Unknown Company';
    // Scoped to (userId + content), never the scraper's shared dedupe
    // namespace — see buildManualJobDedupeKey's docstring for why: reusing
    // that namespace let any user's predictable company/title/location combo
    // overwrite a scraper-owned or another user's Job row via this upsert.
    const dedupeKey = buildManualJobDedupeKey(userId, companyName, title, dto.location, dto.raw_jd);

    // Job.dedupeKey is unique — upsert rather than create so re-analyzing the
    // same job (same user re-pasting/re-submitting the identical JD) reuses
    // the existing row instead of throwing a unique-constraint error.
    const jobData = {
      source: 'manual',
      sourceUrl: dto.source_url,
      title,
      companyName,
      companyInfo: dto.company_info ? ({ raw: dto.company_info } as Json) : undefined,
      rawJd: dto.raw_jd,
      parsedJd: jobDNA as unknown as Json,
      location: dto.location,
      remote: dto.remote ?? false,
      salaryRange: dto.salary_range,
    };
    const job = await this.prisma.job.upsert({
      where: { dedupeKey },
      create: { ...jobData, dedupeKey },
      update: jobData,
    });

    return this.draftForJob(userId, job, jobDNA, onProgress, dto.pages);
  }

  /**
   * Runs the scoring/gap-report/drafting leg shared by three entry points:
   * `analyzeAndDraft` (Job just created from a manual paste),
   * `draftForExistingJob` (Job already ingested by the scraper pipeline,
   * `parsedJd` already computed at ingestion time), and `regenerate` (an
   * existing application, re-drafted from scratch). `pages` defaults to 2 —
   * same default CreateJobSchema applies for the manual-paste entry point —
   * since the scraper entry point has no per-request page-count preference.
   *
   * `existingApplicationId`, when set (the `regenerate` case), updates that
   * row in place instead of creating a new Application — and each branch
   * below explicitly nulls out the *other* branch's field (gapReport vs.
   * resumeSelection), plus the previously-rendered PDF/email fields
   * (resumeSource/renderedWith/resumePdfPath/emailDraft), all as part of
   * the SAME atomic update — so a regenerate that flips branches, or that
   * re-drafts a previously resume-drafted application, never leaves a stale
   * value from the previous draft behind, and a failed draft (LLM error,
   * schema-validation failure, etc.) never partially clears the row.
   *
   * PRECONDITION: callers passing `existingApplicationId` MUST have already
   * verified the application belongs to `userId` — this method does not
   * scope its update by userId (see `regenerate`'s `findOwnedWithJob` call).
   */
  private async draftForJob(
    userId: string,
    job: { id: string; parsedJd: unknown },
    jobDNA: JobDNA,
    onProgress: (step: string) => void,
    pages: 1 | 2 = 2,
    existingApplicationId?: string,
  ): Promise<DraftForJobResult> {
    const db = await this.profileService.getProfile(userId);
    if (!db) {
      throw new BadRequestException(
        'Career profile required before analyzing a job — complete onboarding first',
      );
    }

    onProgress('Comparing against your Career Inventory...');
    const rawCompat = await checkCompatibility(jobDNA, db);
    const parsedCompat = CompatibilityResultSchema.safeParse(rawCompat);
    if (!parsedCompat.success) {
      this.logger.warn(
        `checkCompatibility returned an invalid shape: ${parsedCompat.error.message}`,
      );
      throw new BadRequestException(
        'AI generated an invalid compatibility assessment — please retry the analysis',
      );
    }
    const compat: CompatibilityResult = parsedCompat.data;

    const threshold = DEFAULT_MATCH_THRESHOLD;

    if (compat.score < threshold) {
      onProgress('Building gap report...');
      const gapReport = {
        match_score: compat.score,
        missing_skills: compat.missing_skills,
        strengths: compat.strengths,
        recommendations: compat.recommendations,
      };
      const data = {
        matchScore: compat.score,
        matchReasons: compat.reasons as unknown as Json,
        status: 'gap_reported',
        gapReport: gapReport as unknown as Json,
        resumeSelection: Prisma.JsonNull, // clear any stale selection from a prior draft
        // regenerate case only: clear a previously rendered PDF/email as
        // part of this same atomic write — see this method's docstring.
        ...(existingApplicationId && {
          resumeSource: null,
          renderedWith: null,
          resumePdfPath: null,
          emailDraft: Prisma.JsonNull,
        }),
      };
      const application = existingApplicationId
        ? await this.prisma.application.update({
            where: { id: existingApplicationId },
            data,
          })
        : await this.prisma.application.create({ data: { userId, jobId: job.id, ...data } });

      return {
        applicationId: application.id,
        matchScore: compat.score,
        reasons: compat.reasons,
        gapReport,
      };
    }

    onProgress('Selecting best content from your Inventory for this role...');
    const draft = await selectAndDraft(jobDNA, db, pages);

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

    const data = {
      matchScore: compat.score,
      matchReasons: compat.reasons as unknown as Json,
      status: 'gap_reported', // no resume rendered yet — flips to resume_drafted at finalize
      resumeSelection: selection as unknown as Json,
      gapReport: Prisma.JsonNull, // clear any stale gap report from a prior draft
      // regenerate case only: clear a previously rendered PDF/email as
      // part of this same atomic write — see this method's docstring.
      ...(existingApplicationId && {
        resumeSource: null,
        renderedWith: null,
        resumePdfPath: null,
        emailDraft: Prisma.JsonNull,
      }),
    };
    const application = existingApplicationId
      ? await this.prisma.application.update({ where: { id: existingApplicationId }, data })
      : await this.prisma.application.create({ data: { userId, jobId: job.id, ...data } });

    return {
      applicationId: application.id,
      matchScore: compat.score,
      reasons: compat.reasons,
      selection,
    };
  }

  /**
   * Drafts an application for a Job already ingested by the scraper
   * pipeline — `parsedJd` (JobDNA) was already computed at ingestion time
   * (see jobs.service.ts's `ingestFromScanner`), so there's no `analyzeJob()`
   * call here, unlike `analyzeAndDraft`'s manual-paste entry point.
   */
  async draftForExistingJob(
    userId: string,
    jobId: string,
    onProgress: (step: string) => void,
  ): Promise<DraftForJobResult> {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    // parsedJd can legitimately be null — analyzeJob() may have failed during
    // scraper ingestion (see jobs.service.ts's ingestFromScanner) and left it
    // unset. Fail with a clear, typed error instead of a raw TypeError from
    // deep inside checkCompatibility.
    if (!job.parsedJd) {
      throw new BadRequestException(
        'This job has not been analyzed yet — no parsed job description available',
      );
    }
    const jobDNA = job.parsedJd as unknown as JobDNA;
    return this.draftForJob(userId, job, jobDNA, onProgress);
  }

  /**
   * Re-drafts an existing application from scratch against its Job's
   * already-parsed JD. "Start over" semantics: any previously rendered
   * PDF/email is cleared, but ONLY as part of `draftForJob`'s own atomic
   * update once the LLM drafting pipeline has actually succeeded — nothing
   * destructive happens beforehand, so if `draftForJob` throws (LLM
   * timeout, schema-validation failure, etc.), the row and its PDF file
   * are left completely untouched and the application remains usable. The
   * old PDF file (if any) is only deleted from disk after that successful
   * update — best-effort, since a failed cleanup should never block the
   * regenerate itself from having succeeded.
   */
  async regenerate(
    userId: string,
    applicationId: string,
    onProgress: (step: string) => void,
  ): Promise<DraftForJobResult> {
    const application = await this.findOwnedWithJob(userId, applicationId);
    const job = application.job;
    // Same guard as draftForExistingJob — a scraper-ingested Job's parsedJd
    // can legitimately be null if analyzeJob() failed at ingestion time.
    if (!job.parsedJd) {
      throw new BadRequestException(
        'This job has not been analyzed yet — no parsed job description available',
      );
    }
    const jobDNA = job.parsedJd as unknown as JobDNA;
    const oldResumePdfPath = application.resumePdfPath;

    // Ownership already verified above via findOwnedWithJob — satisfies
    // draftForJob's existingApplicationId precondition.
    const result = await this.draftForJob(userId, job, jobDNA, onProgress, 2, applicationId);

    // Only delete the old PDF once the new draft has been persisted.
    if (oldResumePdfPath) {
      try {
        await this.storage.delete(oldResumePdfPath);
      } catch (err) {
        this.logger.warn(
          `Failed to delete stale resume PDF at ${oldResumePdfPath} during regenerate: ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  /**
   * The applications dashboard's filterable list — thin explicit select,
   * paginated the same way `getDiscoverFeed` is.
   */
  async listApplications(
    userId: string,
    filters: ListApplicationsFiltersDto,
  ): Promise<ListApplicationsResult> {
    const where: Prisma.ApplicationWhereInput = { userId };
    if (filters.status) where.status = filters.status;
    if (filters.company) {
      where.job = { companyName: { contains: filters.company, mode: 'insensitive' } };
    }
    if (filters.date_from || filters.date_to) {
      where.createdAt = {
        ...(filters.date_from && { gte: filters.date_from }),
        ...(filters.date_to && { lte: filters.date_to }),
      };
    }
    if (filters.match_score_min !== undefined || filters.match_score_max !== undefined) {
      where.matchScore = {
        ...(filters.match_score_min !== undefined && { gte: filters.match_score_min }),
        ...(filters.match_score_max !== undefined && { lte: filters.match_score_max }),
      };
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({
        where,
        select: APPLICATION_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.page_size,
        take: filters.page_size,
      }),
    ]);

    return { total, page: filters.page, pageSize: filters.page_size, items };
  }

  /**
   * Summary stats for the applications dashboard landing view.
   */
  async getDashboardSummary(userId: string): Promise<DashboardSummary> {
    const [totalApplications, avgMatchScoreResult, resumesGenerated, gapReportsSaved, recentActivity, savedGapReports] =
      await this.prisma.$transaction([
        this.prisma.application.count({ where: { userId } }),
        // Across ALL applications, including below-threshold gap-reported
        // ones — a more honest number than only counting drafted ones.
        this.prisma.application.aggregate({ where: { userId }, _avg: { matchScore: true } }),
        this.prisma.application.count({ where: { userId, resumePdfPath: { not: null } } }),
        // Prisma.AnyNull (not DbNull) — DbNull only excludes SQL NULL, so
        // `{ not: DbNull }` would incorrectly match rows with a *stored JSON
        // null* gapReport (resume-drafted applications, see draftForJob's
        // `gapReport: Prisma.JsonNull` clear). AnyNull excludes both SQL NULL
        // and JSON null, matching only a genuinely populated gap report.
        this.prisma.application.count({ where: { userId, gapReport: { not: Prisma.AnyNull } } }),
        this.prisma.application.findMany({
          where: { userId },
          select: APPLICATION_LIST_SELECT,
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        // Bounded (max 5), full rows — the frontend's GapReportView needs
        // the full gapReport JSON (and other full fields) for its checkbox
        // interactivity, unlike listApplications/recentActivity's thin select.
        this.prisma.application.findMany({
          where: { userId, status: 'gap_reported', gapReport: { not: Prisma.AnyNull } },
          include: { job: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

    return {
      totalApplications,
      avgMatchScore: Math.round(avgMatchScoreResult._avg.matchScore ?? 0),
      resumesGenerated,
      gapReportsSaved,
      recentActivity,
      savedGapReports,
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
    const companyInfo = formatCompanyInfoForPrompt(application.job.companyInfo);
    const rawEmailDraft = await generateEmail(jobDNA, companyInfo, selection);
    const parsedEmailDraft = UpdateEmailDraftSchema.safeParse(rawEmailDraft);
    if (!parsedEmailDraft.success) {
      this.logger.warn(
        `generateEmail returned an invalid shape: ${parsedEmailDraft.error.message}`,
      );
      throw new BadRequestException(
        'AI generated an invalid email draft — please retry the analysis',
      );
    }
    const emailDraft: EmailDraft = parsedEmailDraft.data;

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

  /**
   * Runs the interview-prep intake leg: deterministically derives the
   * weak-topics checklist from the job's `mandatory_technical_skills` (no
   * LLM call — the checklist is just that list, deduped, for the user to
   * self-flag against), then makes ONE lightweight LLM call to generate 2-4
   * JD/company-grounded dynamic questions. Clears any stale prior report on
   * regeneration — same "clear sibling state atomically in one write"
   * convention as `draftForJob`'s branch-flip nulling.
   */
  async generateInterviewPrepIntake(
    userId: string,
    applicationId: string,
  ): Promise<InterviewPrepState> {
    const application = await this.findOwnedWithJob(userId, applicationId);
    if (!application.resumeSelection) {
      throw new BadRequestException(
        'Resume selection required before preparing for interview — finalize the application first',
      );
    }

    const jobDNA = application.job.parsedJd as unknown as JobDNA;
    const selection = application.resumeSelection as unknown as AISelection;
    const companyInfoText = formatCompanyInfoForPrompt(application.job.companyInfo);

    const weakTopics = Array.from(new Set(jobDNA.mandatory_technical_skills));
    const rawQuestions = await generateInterviewIntakeQuestions(jobDNA, companyInfoText, selection);

    // The LLM's JSON output is parsed with no runtime shape guarantees —
    // validate it before persisting, same defensive pattern as
    // generateInterviewPrepReport's InterviewPrepReportSchema.safeParse() gate.
    const parsedQuestions = InterviewIntakeQuestionsSchema.safeParse(rawQuestions);
    if (!parsedQuestions.success) {
      throw new BadRequestException(
        'AI generated invalid interview intake questions — please retry',
      );
    }
    const questions = parsedQuestions.data;

    const state: InterviewPrepState = {
      intake: { weak_topics: weakTopics, questions },
      report: null, // clear any stale report from a prior generate — same write
    };

    await this.prisma.application.update({
      where: { id: applicationId },
      data: { interviewPrep: state as unknown as Json },
    });

    return state;
  }

  /**
   * PATCH-style update of the intake form answers — mirrors `updateGapReport`'s
   * shape (ownership check, single validated write), but merges into the
   * existing `intake` object (weak_topics/questions) rather than overwriting
   * the whole JSON column, since those fields were already persisted by
   * `generateInterviewPrepIntake` and must survive this write. Nulls any
   * previously-generated `report` — a report is synthesized from a specific
   * answer set, so editing the answers invalidates it, and the user must
   * explicitly regenerate.
   */
  async updateInterviewPrepIntakeAnswers(
    userId: string,
    applicationId: string,
    answers: InterviewPrepIntakeAnswersDto,
  ): Promise<InterviewPrepState> {
    const application = await this.findOwned(userId, applicationId);
    const existing = application.interviewPrep as unknown as InterviewPrepState | null;
    if (!existing?.intake) {
      throw new BadRequestException(
        'Generate the interview prep intake questions before submitting answers',
      );
    }

    const state: InterviewPrepState = {
      intake: { ...existing.intake, answers },
      report: null, // edited answers invalidate any previously-generated report
    };

    await this.prisma.application.update({
      where: { id: applicationId },
      data: { interviewPrep: state as unknown as Json },
    });

    return state;
  }

  /**
   * Runs the interview-prep report synthesis leg: two focused LLM calls,
   * SEQUENTIALLY (technical, then behavioral), each preceded by a real
   * progress checkpoint — matching this codebase's "each SSE progress event =
   * one real await boundary" convention. The merged result is validated via
   * `InterviewPrepReportSchema.safeParse()` before persisting, same defensive
   * pattern as `draftForJob`'s `UpdateResumeSelectionSchema.safeParse()` gate.
   */
  async generateInterviewPrepReport(
    userId: string,
    applicationId: string,
    onProgress: (step: string) => void,
  ): Promise<InterviewPrepReportDto> {
    const application = await this.findOwnedWithJob(userId, applicationId);
    if (!application.resumeSelection) {
      throw new BadRequestException(
        'Resume selection required before preparing for interview — finalize the application first',
      );
    }
    const state = application.interviewPrep as unknown as InterviewPrepState | null;
    if (!state?.intake?.answers) {
      throw new BadRequestException('Answer the interview prep intake questions first');
    }

    const db = await this.profileService.getProfile(userId);
    if (!db) throw new BadRequestException('Career profile not found');

    const jobDNA = application.job.parsedJd as unknown as JobDNA;
    const selection = application.resumeSelection as unknown as AISelection;
    const companyInfoText = formatCompanyInfoForPrompt(application.job.companyInfo);
    const answers = state.intake.answers;

    onProgress('Analyzing likely technical topics...');
    const technical = await generateTechnicalInterviewPrep(jobDNA, db, selection, answers);

    onProgress('Analyzing likely behavioral questions...');
    const behavioral = await generateBehavioralInterviewPrep(
      jobDNA,
      companyInfoText,
      db,
      selection,
      answers,
    );

    // The LLM's JSON output is parsed with no runtime shape guarantees —
    // validate the merged synthesis result before persisting, same gate
    // draftForJob applies to the resume-selection critique output.
    const parsed = InterviewPrepReportSchema.safeParse({ ...technical, ...behavioral });
    if (!parsed.success) {
      throw new BadRequestException(
        'AI generated an invalid interview prep report — please retry',
      );
    }
    const report = parsed.data;

    const newState: InterviewPrepState = { intake: state.intake, report };
    await this.prisma.application.update({
      where: { id: applicationId },
      data: { interviewPrep: newState as unknown as Json },
    });

    return report;
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
    return normalizeApplicationRow(application);
  }
}

/**
 * Normalizes an Application row's LLM-sourced JSON columns on the read path.
 * `draftForJob` has validated/coerced this shape at write time since commit
 * 6670055, but rows persisted BEFORE that fix can still hold the pre-fix
 * shape (e.g. `matchReasons` as a bare string instead of `string[]`) —
 * without this, `MatchScoreDisplay`'s `reasons.map()` crashes the
 * application detail page for any user with a legacy row. Read-time
 * coercion only, per product decision — no DB backfill.
 */
function normalizeApplicationRow<T extends { matchReasons: unknown; gapReport: unknown }>(
  application: T,
): T {
  const gapReport = application.gapReport as {
    missing_skills?: unknown;
    strengths?: unknown;
    recommendations?: unknown;
    [key: string]: unknown;
  } | null;

  const missingSkills = Array.isArray(gapReport?.missing_skills)
    ? gapReport.missing_skills.map((item: unknown) => {
        const skill = item as { suggested_resources?: unknown; [key: string]: unknown };
        return { ...skill, suggested_resources: coerceToStringArray(skill?.suggested_resources) };
      })
    : gapReport?.missing_skills;

  return {
    ...application,
    matchReasons: coerceToStringArray(application.matchReasons),
    gapReport: gapReport
      ? {
          ...gapReport,
          missing_skills: missingSkills,
          strengths: coerceToStringArray(gapReport.strengths),
          recommendations: coerceToStringArray(gapReport.recommendations),
        }
      : gapReport,
  };
}

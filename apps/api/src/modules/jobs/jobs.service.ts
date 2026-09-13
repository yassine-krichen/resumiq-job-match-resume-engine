import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Job, Prisma } from '@prisma/client';
import { checkCompatibility } from '@resumiq/ai-bridge';
import type { JobDNA } from '@resumiq/ai-bridge';
import { scanTrackedCompanies } from '@resumiq/job-scanner';
import { CompatibilityResultSchema, UpdateUserSettingsSchema, UserSettingsSchema } from '@resumiq/schemas';
import type { DiscoverFeedFiltersDto, UpdateUserSettingsDto, UserSettingsDto } from '@resumiq/schemas';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { RESUME_GEN_QUEUE } from '../queue/queue.module';
import { HunterClient } from './enrichment/hunter.client';
import { PeopleDataLabsClient } from './enrichment/people-data-labs.client';
import { ingestScrapedJobs } from './ingest-scraped-jobs';

type Json = Prisma.InputJsonValue;

/** How many newest un-fresh jobs get a match-preview computed per refresh
 * call — keeps a single refresh bounded regardless of how large `jobs` gets. */
const MAX_PREVIEW_CANDIDATES = 40;

const PREVIEW_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export interface DiscoverFeedResult {
  total: number;
  page: number;
  pageSize: number;
  items: Array<{ job: Job; matchScore: number }>;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileService: ProfileService,
    private readonly hunterClient: HunterClient,
    private readonly pdlClient: PeopleDataLabsClient,
    @InjectQueue(RESUME_GEN_QUEUE) private readonly resumeGenQueue: Queue,
  ) {}

  /**
   * Scans every tracked company/board via @resumiq/job-scanner, dedupes
   * against Job.dedupeKey (skips rows that already exist), and for genuinely
   * new rows analyzes the JD (bounded concurrency) then attempts enrichment
   * (best-effort, never blocks ingestion on failure).
   */
  async ingestFromScanner(): Promise<{ scanned: number; created: number }> {
    const scraped = await scanTrackedCompanies();
    return ingestScrapedJobs(scraped, {
      prisma: this.prisma,
      hunterClient: this.hunterClient,
      pdlClient: this.pdlClient,
      logger: this.logger,
    });
  }

  /**
   * The `/discover` swipe feed: pre-computed match previews joined with
   * jobs, filtered by the user's threshold + the request's filter params,
   * excludes dismissed jobs, paginated (never an unbounded collection).
   */
  async getDiscoverFeed(
    userId: string,
    filters: DiscoverFeedFiltersDto,
  ): Promise<DiscoverFeedResult> {
    const settings = await this.getUserSettings(userId);

    const jobWhere: Prisma.JobWhereInput = {
      dismissedBy: { none: { userId } },
    };
    if (filters.location) {
      jobWhere.location = { contains: filters.location, mode: 'insensitive' };
    }
    if (filters.work_mode?.length) {
      // Best-effort mapping: "remote" in the requested work modes matches
      // Job.remote; any other requested mode (hybrid/onsite) falls back to
      // "not flagged remote" since we don't have a structured work-mode
      // field on Job yet (Phase 3 doesn't model it beyond this boolean).
      jobWhere.remote = filters.work_mode.includes('remote');
    }
    if (filters.category_tags?.length) {
      jobWhere.OR = filters.category_tags.map((tag) => ({
        title: { contains: tag, mode: 'insensitive' as const },
      }));
    }

    const [total, previews] = await this.prisma.$transaction([
      this.prisma.jobMatchPreview.count({
        where: { userId, matchScore: { gte: settings.match_threshold }, job: jobWhere },
      }),
      this.prisma.jobMatchPreview.findMany({
        where: { userId, matchScore: { gte: settings.match_threshold }, job: jobWhere },
        include: { job: true },
        orderBy: { matchScore: 'desc' },
        skip: (filters.page - 1) * filters.page_size,
        take: filters.page_size,
      }),
    ]);

    // Seniority isn't a Job column (it lives inside parsedJd/JobDNA) —
    // filtered in-memory after the paginated DB fetch rather than pushed
    // into the WHERE clause, which Prisma can't express against JSON shape
    // without a raw query.
    const filtered = filters.seniority
      ? previews.filter((p) => {
          const jobDNA = p.job.parsedJd as unknown as JobDNA | null;
          return jobDNA?.seniority?.toLowerCase() === filters.seniority?.toLowerCase();
        })
      : previews;

    return {
      total,
      page: filters.page,
      pageSize: filters.page_size,
      items: filtered.map((p) => ({ job: p.job, matchScore: p.matchScore })),
    };
  }

  /** Ownership-agnostic — Job isn't owned by a user, just records this user dismissed it. */
  async dismiss(userId: string, jobId: string): Promise<void> {
    await this.assertJobExists(jobId);
    await this.prisma.dismissedJob.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId },
      update: {},
    });
  }

  /** Swipe right — queues the full background apply pipeline, never blocks the swiper. */
  async swipeRight(userId: string, jobId: string): Promise<void> {
    await this.assertJobExists(jobId);
    await this.resumeGenQueue.add('generate', { userId, jobId });
  }

  /** A bogus jobId should fail cleanly at the API boundary — not deep inside
   * the background processor or as an unhandled FK-constraint error. */
  private async assertJobExists(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
  }

  /**
   * Computes/refreshes match previews for jobs the user has no fresh
   * (<24h) preview for, capped at the newest MAX_PREVIEW_CANDIDATES —
   * bounded so a growing `jobs` table never makes one refresh unbounded.
   */
  async refreshMatchPreviews(userId: string): Promise<{ refreshed: number }> {
    const db = await this.profileService.getProfile(userId);
    if (!db) return { refreshed: 0 };

    const freshCutoff = new Date(Date.now() - PREVIEW_FRESHNESS_MS);
    const candidates = await this.prisma.job.findMany({
      where: {
        parsedJd: { not: Prisma.DbNull },
        OR: [
          { matchPreviews: { none: { userId } } },
          { matchPreviews: { some: { userId, computedAt: { lt: freshCutoff } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_PREVIEW_CANDIDATES,
    });

    let refreshed = 0;
    for (const job of candidates) {
      try {
        const jobDNA = job.parsedJd as unknown as JobDNA;
        const rawCompat = await checkCompatibility(jobDNA, db);
        const parsedCompat = CompatibilityResultSchema.safeParse(rawCompat);
        if (!parsedCompat.success) {
          throw new Error(`checkCompatibility returned an invalid shape: ${parsedCompat.error.message}`);
        }
        const compat = parsedCompat.data;
        await this.prisma.jobMatchPreview.upsert({
          where: { userId_jobId: { userId, jobId: job.id } },
          create: { userId, jobId: job.id, matchScore: compat.score },
          update: { matchScore: compat.score, computedAt: new Date() },
        });
        refreshed++;
      } catch (err) {
        this.logger.warn(`match-preview refresh failed for job ${job.id}: ${errorMessage(err)}`);
      }
    }
    return { refreshed };
  }

  async getUserSettings(userId: string): Promise<UserSettingsDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { settings: true },
    });
    const parsed = UserSettingsSchema.safeParse(user.settings);
    return parsed.success ? parsed.data : UserSettingsSchema.parse({});
  }

  async updateUserSettings(userId: string, patch: UpdateUserSettingsDto): Promise<UserSettingsDto> {
    const current = await this.getUserSettings(userId);
    const merged = UserSettingsSchema.parse({ ...current, ...UpdateUserSettingsSchema.parse(patch) });
    await this.prisma.user.update({
      where: { id: userId },
      data: { settings: merged as unknown as Json },
    });
    return merged;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { PrismaClient, Prisma } from '@prisma/client';
import { analyzeJob } from '@resumiq/ai-bridge';
import type { ScrapedJobInput } from '@resumiq/job-scanner';
import { JobDNASchema } from '@resumiq/schemas';
import { buildJobDedupeKey } from '../../common/jobs/dedupe-key';
import { HunterClient } from './enrichment/hunter.client';
import { PeopleDataLabsClient } from './enrichment/people-data-labs.client';

type Json = Prisma.InputJsonValue;

/** Batch size for analyzeJob() calls during ingestion — not fully sequential
 * (too slow for ~90-source scans) nor fully parallel (would hammer the LLM
 * provider and any per-provider rate limits all at once). */
const ANALYZE_CONCURRENCY = 3;

export interface IngestScrapedJobsDeps {
  prisma: Pick<PrismaClient, 'job'>;
  hunterClient: HunterClient;
  pdlClient: PeopleDataLabsClient;
  logger?: { warn(msg: string): void };
}

/**
 * Dedupes scraped job input against Job.dedupeKey (skips rows that already
 * exist), and for genuinely new rows analyzes the JD (bounded concurrency)
 * then attempts enrichment (best-effort, never blocks ingestion on failure).
 *
 * DI-free by design — callable from both JobsService (Nest DI) and the
 * standalone `scripts/scan-and-ingest.ts` CLI entrypoint (no Nest bootstrap).
 */
export async function ingestScrapedJobs(
  scraped: ScrapedJobInput[],
  deps: IngestScrapedJobsDeps,
): Promise<{ scanned: number; created: number }> {
  const { prisma, hunterClient, pdlClient, logger } = deps;

  const newJobs: Array<{ id: string; input: ScrapedJobInput }> = [];
  for (const input of scraped) {
    const dedupeKey = buildJobDedupeKey(input.company, input.title, input.location);
    const existing = await prisma.job.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (existing) continue;

    const job = await prisma.job.create({
      data: {
        dedupeKey,
        source: 'scraper',
        sourceUrl: input.url,
        title: input.title,
        companyName: input.company,
        rawJd: input.description ?? '',
        location: input.location,
        remote: /remote/i.test(input.location ?? ''),
      },
    });
    newJobs.push({ id: job.id, input });
  }

  await runWithConcurrencyLimit(newJobs, ANALYZE_CONCURRENCY, async ({ id, input }) => {
    if (!input.description) return; // nothing to analyze — parsedJd stays null
    try {
      const rawJobDNA = await analyzeJob(input.description, '');
      const parsedJobDNA = JobDNASchema.safeParse(rawJobDNA);
      if (!parsedJobDNA.success) {
        throw new Error(`analyzeJob returned an invalid shape: ${parsedJobDNA.error.message}`);
      }
      await prisma.job.update({
        where: { id },
        data: { parsedJd: parsedJobDNA.data as unknown as Json },
      });
    } catch (err) {
      logger?.warn(`analyzeJob failed for job ${id} (${input.company}): ${errorMessage(err)}`);
    }
  });

  // Enrichment is additive — a failure here must never fail ingestion, and
  // never blocks on a slow/unset provider (each client already no-ops
  // gracefully when its API key is unset).
  for (const { id, input } of newJobs) {
    try {
      const [companyProfile, contact] = await Promise.all([
        pdlClient.findCompanyProfile(input.company),
        hunterClient.findContact(input.company),
      ]);
      if (companyProfile || contact) {
        await prisma.job.update({
          where: { id },
          data: { companyInfo: { profile: companyProfile, contact } as unknown as Json },
        });
      }
    } catch (err) {
      logger?.warn(`enrichment failed for job ${id} (${input.company}): ${errorMessage(err)}`);
    }
  }

  return { scanned: scraped.length, created: newJobs.length };
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

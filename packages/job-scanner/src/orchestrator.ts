import { getTrackedCompanies } from './tracked-companies';
import { loadProvider, makeProviderHttpContext, SUPPORTED_PROVIDER_IDS } from './provider-loader';
import type { SupportedProviderId } from './provider-loader';
import { backfillDescription } from './detail-fetch';
import type { CareerOpsHttpContext, ScrapedJobInput, TrackedCompany } from './types';

/** Bounded concurrency for per-job detail-page fetches — mirrors the
 * ANALYZE_CONCURRENCY pattern used for LLM calls in apps/api's ingestion
 * pipeline: fully sequential is too slow across a large scan, fully
 * parallel risks hammering description-less boards' own posting pages. */
const DETAIL_FETCH_CONCURRENCY = 3;

function isSupportedProviderId(id: string): id is SupportedProviderId {
  return (SUPPORTED_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * Scans every enabled entry in tracked-companies.json via its vendored
 * career-ops provider and returns the combined, flattened job list.
 *
 * Error isolation: one provider/company throwing (network failure, a board
 * moved, a malformed response) must never kill the whole scan — it's caught,
 * logged, and the scan continues with the remaining entries. A daily cron
 * job with 5 of 10 companies down should still ingest the other 5, not zero.
 */
export async function scanTrackedCompanies(): Promise<ScrapedJobInput[]> {
  const entries = getTrackedCompanies().filter((entry) => entry.enabled !== false);
  const ctx = await makeProviderHttpContext();

  const results: ScrapedJobInput[] = [];
  for (const entry of entries) {
    try {
      const jobs = await scanEntry(entry, ctx);
      results.push(...jobs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`job-scanner: failed to scan "${entry.name}" (${entry.provider}) — ${message}`);
    }
  }
  return results;
}

async function scanEntry(
  entry: TrackedCompany,
  ctx: Awaited<ReturnType<typeof makeProviderHttpContext>>,
): Promise<ScrapedJobInput[]> {
  if (!isSupportedProviderId(entry.provider)) {
    throw new Error(`unsupported provider id "${entry.provider}"`);
  }
  const provider = await loadProvider(entry.provider);

  // detect() is optional on the provider contract (remoteok/remotive skip it
  // entirely — they're board-wide aggregators with nothing to auto-detect).
  // When present, it also validates the entry resolves to a real API
  // endpoint before we spend a network call on it.
  if (provider.detect && !provider.detect(entry)) {
    throw new Error(`provider "${provider.id}" could not resolve an API endpoint for this entry`);
  }

  const jobs = await provider.fetch(entry, ctx);
  return backfillMissingDescriptions(jobs, ctx);
}

/**
 * Backfills `description` (via detail-fetch.ts) for every job the provider
 * returned without one, bounded to DETAIL_FETCH_CONCURRENCY in flight —
 * jobs that already have a description are left untouched, no network call.
 */
async function backfillMissingDescriptions(
  jobs: ScrapedJobInput[],
  ctx: CareerOpsHttpContext,
): Promise<ScrapedJobInput[]> {
  const results = [...jobs];
  const pending = results
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => !job.description);
  if (pending.length === 0) return results;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const { job, index } = pending[cursor++];
      // backfillDescription is designed to never throw, but a single bad job
      // must not take down the rest of this Promise.all batch if it ever does.
      try {
        results[index] = await backfillDescription(job, ctx);
      } catch {
        // leave the job as-is; it just stays description-less.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DETAIL_FETCH_CONCURRENCY, pending.length) }, () => worker()),
  );
  return results;
}

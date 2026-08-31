import { getTrackedCompanies } from './tracked-companies';
import { loadProvider, makeProviderHttpContext, SUPPORTED_PROVIDER_IDS } from './provider-loader';
import type { SupportedProviderId } from './provider-loader';
import type { ScrapedJobInput, TrackedCompany } from './types';

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

  return provider.fetch(entry, ctx);
}

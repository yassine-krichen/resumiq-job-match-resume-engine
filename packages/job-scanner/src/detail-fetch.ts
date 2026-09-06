import { loadHtmlToText } from './provider-loader';
import type { CareerOpsHttpContext, ScrapedJobInput } from './types';

const JSON_LD_SCRIPT_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Phase A of the description-less-provider fix (RemoteOK/Himalayas/Remotive/
 * WeWorkRemotely — their list APIs return no `description` field at all):
 * fetches the job's own posting page via the same SSRF-hardened HTTP context
 * every provider already uses, and looks for schema.org JobPosting JSON-LD
 * markup to backfill it. Best-effort — any fetch/parse failure, or the
 * absence of usable JSON-LD, leaves the job unchanged rather than failing
 * the scan (DOM-scraping fallback for sites with no JSON-LD is Phase B,
 * deliberately out of scope here).
 */
export async function backfillDescription(
  job: ScrapedJobInput,
  ctx: CareerOpsHttpContext,
): Promise<ScrapedJobInput> {
  if (job.description) return job;

  let html: string;
  try {
    html = await ctx.fetchText(job.url, { redirect: 'error' });
  } catch {
    return job;
  }

  const rawDescription = extractJobPostingDescription(html);
  if (!rawDescription) return job;

  let description: string;
  try {
    const htmlToText = await loadHtmlToText();
    description = htmlToText(rawDescription);
  } catch {
    return job;
  }
  if (!description) return job;

  return { ...job, description };
}

/**
 * Scans every `<script type="application/ld+json">` block for a schema.org
 * `JobPosting` entry (JSON-LD may also be an `@graph` array or a bare array
 * of typed objects) and returns its raw `description`. Never throws — a
 * malformed or missing block just means no candidate is returned.
 */
function extractJobPostingDescription(html: string): string | null {
  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        (candidate as { '@type'?: unknown })['@type'] === 'JobPosting' &&
        typeof (candidate as { description?: unknown }).description === 'string'
      ) {
        return (candidate as { description: string }).description;
      }
    }
  }
  return null;
}

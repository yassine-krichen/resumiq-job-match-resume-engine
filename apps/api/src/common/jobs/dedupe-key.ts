import { createHash } from 'crypto';

/**
 * Lowercase, trim, collapse whitespace, strip punctuation. Used to build a
 * normalized dedupe key so casing/whitespace drift across scrape runs (or a
 * user re-pasting the same JD with different formatting) doesn't create
 * duplicate Job rows.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Job.dedupeKey — a normalized `slugify(companyName)|slugify(title)|slugify(location ?? '')`.
 * Replaces a raw (companyName, title, location) composite unique, which
 * breaks on NULL locations (Postgres treats each NULL as distinct) and
 * casing/whitespace drift across scrape runs.
 */
export function buildJobDedupeKey(
  companyName: string,
  title: string,
  location?: string | null,
): string {
  return [slugify(companyName), slugify(title), slugify(location ?? '')].join('|');
}

/**
 * Manual-paste Job.dedupeKey — scoped to (user + content), never to content
 * alone. `buildJobDedupeKey` builds a key shared with the scraper ingestion
 * pipeline (see jobs.service.ts's `ingestFromScanner`), which trusts collision
 * as "same job" and skips re-creating it. The manual-paste flow uses `upsert`
 * (not create-only) so a user re-submitting the same JD reuses their row
 * instead of hitting a unique-constraint error — but reusing the scraper's
 * shared namespace for that upsert meant any user submitting a predictable
 * company/title/location combo (e.g. "Stripe" + "Backend Engineer" + "Remote")
 * could silently overwrite a scraper-owned or another user's Job row,
 * poisoning `rawJd`/`parsedJd` fed into that other pipeline's LLM prompts.
 *
 * Namespaced under `manual:${userId}:` so it can never collide with the
 * scraper's keys, and includes a content hash of the raw JD text (not just
 * title/company/location) so genuinely different JD text from the same user
 * never collides either — only an exact re-paste of the same JD by the same
 * user reuses the row.
 */
export function buildManualJobDedupeKey(
  userId: string,
  companyName: string,
  title: string,
  location: string | null | undefined,
  rawJd: string,
): string {
  const contentHash = createHash('sha256').update(rawJd).digest('hex').slice(0, 16);
  return `manual:${userId}:${[slugify(companyName), slugify(title), slugify(location ?? ''), contentHash].join('|')}`;
}

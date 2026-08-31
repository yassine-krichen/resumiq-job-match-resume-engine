import { Injectable, Logger } from '@nestjs/common';

export interface CompanyProfile {
  industry?: string;
  size?: string;
  founded?: number;
  summary?: string;
  tags?: string[];
}

/**
 * Thin typed wrapper around People Data Labs' company-enrichment endpoint —
 * not a full SDK. Used for `Job.companyInfo` profile detail (industry,
 * size, tags). Free tier: 100 lookups/month; contact-specific fields are
 * masked on the free tier, but company-profile fields (what we use) aren't.
 *
 * If PDL_API_KEY is unset, every call no-ops (logs once, returns null) —
 * enrichment must never block job ingestion.
 */
@Injectable()
export class PeopleDataLabsClient {
  private readonly logger = new Logger(PeopleDataLabsClient.name);
  private warnedMissingKey = false;

  /** Best-effort company profile lookup by company name or domain. */
  async findCompanyProfile(companyNameOrDomain: string): Promise<CompanyProfile | null> {
    const apiKey = process.env.PDL_API_KEY;
    if (!apiKey) {
      if (!this.warnedMissingKey) {
        this.logger.warn('PDL_API_KEY not set — skipping company enrichment (fields stay null)');
        this.warnedMissingKey = true;
      }
      return null;
    }

    try {
      const url = new URL('https://api.peopledatalabs.com/v5/company/enrich');
      url.searchParams.set('name', companyNameOrDomain);

      const res = await fetch(url, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`People Data Labs lookup failed for ${companyNameOrDomain}: HTTP ${res.status}`);
        return null;
      }

      const body = (await res.json()) as Record<string, unknown>;
      return {
        industry: typeof body.industry === 'string' ? body.industry : undefined,
        size: typeof body.size === 'string' ? body.size : undefined,
        founded: typeof body.founded === 'number' ? body.founded : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`People Data Labs lookup threw for ${companyNameOrDomain}: ${message}`);
      return null;
    }
  }
}

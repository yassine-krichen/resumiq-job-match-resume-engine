import { Injectable, Logger } from '@nestjs/common';

export interface HunterContact {
  email: string;
  confidence: number;
  firstName?: string;
  lastName?: string;
  position?: string;
}

/**
 * Thin typed wrapper around Hunter.io's domain-search endpoint — not a full
 * SDK. Used for cold-email recipient discovery. Free tier: 50 credits/month.
 *
 * If HUNTER_API_KEY is unset, every call no-ops (logs once, returns null) —
 * enrichment must never block job ingestion.
 */
@Injectable()
export class HunterClient {
  private readonly logger = new Logger(HunterClient.name);
  private warnedMissingKey = false;

  /**
   * Best-effort domain-search lookup for a likely hiring/recruiting contact.
   * Hunter's domain-search endpoint accepts either `domain` or `company` —
   * scraped job postings usually only give us a company name, not a
   * verified domain, so `company` is what's actually used most of the time.
   */
  async findContact(companyName: string, domain?: string): Promise<HunterContact | null> {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) {
      if (!this.warnedMissingKey) {
        this.logger.warn('HUNTER_API_KEY not set — skipping contact enrichment (fields stay null)');
        this.warnedMissingKey = true;
      }
      return null;
    }

    try {
      const url = new URL('https://api.hunter.io/v2/domain-search');
      if (domain) url.searchParams.set('domain', domain);
      else url.searchParams.set('company', companyName);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('limit', '1');
      url.searchParams.set('seniority', 'senior,executive');

      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`Hunter.io lookup failed for ${companyName}: HTTP ${res.status}`);
        return null;
      }

      const body = (await res.json()) as {
        data?: { emails?: Array<Record<string, unknown>> };
      };
      const top = body.data?.emails?.[0];
      if (!top || typeof top.value !== 'string') return null;

      return {
        email: top.value,
        confidence: typeof top.confidence === 'number' ? top.confidence : 0,
        firstName: typeof top.first_name === 'string' ? top.first_name : undefined,
        lastName: typeof top.last_name === 'string' ? top.last_name : undefined,
        position: typeof top.position === 'string' ? top.position : undefined,
      };
    } catch (err) {
      // Never let an enrichment failure propagate into the ingestion pipeline.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Hunter.io lookup threw for ${companyName}: ${message}`);
      return null;
    }
  }
}

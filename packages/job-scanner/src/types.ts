/**
 * Normalized job posting returned by a career-ops provider's `fetch()`. Maps
 * ~1:1 onto CreateJobSchema in @resumiq/schemas: title→title,
 * company→company_name, location→location, description→raw_jd,
 * url→source_url.
 */
export interface ScrapedJobInput {
  title: string;
  url: string;
  company: string;
  location: string;
  description?: string;
  postedAt?: number;
}

/**
 * One entry in tracked-companies.json — the subset of career-ops's
 * `PortalEntry` shape our providers actually read. `provider` pins the
 * provider id directly (used by board aggregators like remoteok/himalayas
 * that have no per-company `careers_url` to auto-detect from); `careers_url`
 * / `api` are read by the per-company ATS providers (greenhouse, lever,
 * ashby, workday, smartrecruiters) to resolve their JSON API endpoint.
 */
export interface TrackedCompany {
  name: string;
  provider: string;
  careers_url?: string;
  api?: string;
  enabled?: boolean;
}

/**
 * The subset of the career-ops provider contract we depend on. Loaded
 * dynamically from the vendored `.mjs` files — see provider-loader.ts.
 */
export interface CareerOpsProvider {
  id: string;
  detect?: (entry: TrackedCompany) => { url: string } | null;
  fetch: (entry: TrackedCompany, ctx: CareerOpsHttpContext) => Promise<ScrapedJobInput[]>;
}

/** Matches career-ops's `makeHttpCtx()` output in providers/_http.mjs. */
export interface CareerOpsHttpContext {
  transport: 'http';
  fetchJson: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
  fetchText: (url: string, opts?: Record<string, unknown>) => Promise<string>;
  fetchResponse: (url: string, opts?: Record<string, unknown>) => Promise<Response>;
}

import type { DiscoverFeedFiltersDto, UpdateUserSettingsDto, UserSettingsDto } from '@resumiq/schemas';

// The filter params the UI cares about — `page`/`page_size` are handled
// internally by the feed query, not exposed through the filter bar.
export type DiscoverFilters = Pick<
  DiscoverFeedFiltersDto,
  'category_tags' | 'work_mode' | 'location' | 'seniority'
>;

/** Subset of @resumiq/ai-bridge's JobDNA actually rendered on a job card —
 * ai-bridge isn't a web dependency (see apply/manual/_components/types.ts),
 * so this is declared locally rather than imported cross-package. */
export interface JobDna {
  seniority?: string;
  mandatory_technical_skills?: string[];
  nice_to_have_skills?: string[];
}

/** A `Job` row as returned by GET /api/jobs/discover. */
export interface DiscoverJob {
  id: string;
  title: string;
  companyName: string;
  location: string | null;
  remote: boolean;
  salaryRange: string | null;
  parsedJd: JobDna | null;
}

export interface DiscoverFeedItem {
  job: DiscoverJob;
  matchScore: number;
}

/** Response of GET /api/jobs/discover. */
export interface DiscoverFeedResult {
  total: number;
  page: number;
  pageSize: number;
  items: DiscoverFeedItem[];
}

export type UserSettings = UserSettingsDto;
export type UpdateUserSettings = UpdateUserSettingsDto;

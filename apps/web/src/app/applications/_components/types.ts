// The filter params the UI cares about — dates as plain `yyyy-mm-dd` strings
// (straight out of `<input type="date">`), coerced server-side by
// `ListApplicationsFiltersSchema`'s `z.coerce.date()`.
export interface ApplicationsFilters {
  status?: string;
  company?: string;
  date_from?: string;
  date_to?: string;
  match_score_min?: number;
  match_score_max?: number;
}

/** A single row as returned by GET /api/applications — thin, explicit select
 * (`APPLICATION_LIST_SELECT` on the backend), deliberately excludes the
 * gapReport/resumeSelection/resumeSource JSON blobs the list view never needs. */
export interface ApplicationListItem {
  id: string;
  status: string;
  matchScore: number;
  createdAt: string;
  updatedAt: string;
  job: {
    id: string;
    title: string;
    companyName: string;
    location: string | null;
  };
}

/** Response of GET /api/applications. */
export interface ListApplicationsResult {
  total: number;
  page: number;
  pageSize: number;
  items: ApplicationListItem[];
}

/** Human-readable labels for `ApplicationListItem['status']` — shared by the
 * applications table and the dashboard's recent-activity list so the two
 * views never drift out of sync. */
export const STATUS_LABELS: Record<string, string> = {
  gap_reported: 'Gap reported',
  resume_drafted: 'Resume drafted',
  email_drafted: 'Email drafted',
  ready: 'Ready',
};

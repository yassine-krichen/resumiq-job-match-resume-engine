import { apiFetch } from '@/lib/api';
import type { ApplicationsFilters, ListApplicationsResult } from './types';

function buildApplicationsQuery(filters: ApplicationsFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.company) params.set('company', filters.company);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  if (filters.match_score_min !== undefined) {
    params.set('match_score_min', String(filters.match_score_min));
  }
  if (filters.match_score_max !== undefined) {
    params.set('match_score_max', String(filters.match_score_max));
  }
  params.set('page', String(page));
  return params.toString();
}

export function getApplications(
  filters: ApplicationsFilters,
  page: number,
): Promise<ListApplicationsResult> {
  return apiFetch<ListApplicationsResult>(`/applications?${buildApplicationsQuery(filters, page)}`);
}

import { apiFetch } from '@/lib/api';
import type { DiscoverFeedResult, DiscoverFilters } from './types';

function buildDiscoverQuery(filters: DiscoverFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.category_tags?.length) params.set('category_tags', filters.category_tags.join(','));
  if (filters.work_mode?.length) params.set('work_mode', filters.work_mode.join(','));
  if (filters.location) params.set('location', filters.location);
  if (filters.seniority) params.set('seniority', filters.seniority);
  params.set('page', String(page));
  return params.toString();
}

export function getDiscoverFeed(
  filters: DiscoverFilters,
  page: number,
): Promise<DiscoverFeedResult> {
  return apiFetch<DiscoverFeedResult>(`/jobs/discover?${buildDiscoverQuery(filters, page)}`);
}

export function dismissJob(jobId: string): Promise<{ dismissed: boolean }> {
  return apiFetch(`/jobs/${jobId}/dismiss`, { method: 'POST' });
}

export function swipeRightJob(jobId: string): Promise<{ queued: boolean }> {
  return apiFetch(`/jobs/${jobId}/swipe-right`, { method: 'POST' });
}

/** Login-trigger substitute — see the backend's `refreshPreviews` doc comment. */
export function refreshMatchPreviews(): Promise<{ refreshed: number }> {
  return apiFetch('/jobs/refresh-previews', { method: 'POST' });
}

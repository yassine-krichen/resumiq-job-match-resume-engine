import { apiFetch } from '@/lib/api';
import type { DashboardSummary } from './types';

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/applications/dashboard-summary');
}

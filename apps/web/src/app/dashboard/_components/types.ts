// Reused directly from the /applications and /apply/manual features —
// dashboard-summary's `recentActivity` is the same thin shape
// `listApplications` returns, and `savedGapReports` reuses `GapReport`'s
// shape from the shared review UI.
import type { ApplicationListItem } from '../../applications/_components/types';
import type { GapReport } from '../../apply/manual/_components/types';

export type { ApplicationListItem };

/** One row of GET /api/applications/dashboard-summary's `savedGapReports` —
 * the backend returns the full Application+Job row (bounded to 5), but the
 * dashboard only ever reads these fields (`GapReportView` needs the rest of
 * the gap-report-specific shape, not the whole row). */
export interface SavedGapReportItem {
  id: string;
  gapReport: GapReport;
  job: {
    id: string;
    title: string;
    companyName: string;
  };
}

/** Response of GET /api/applications/dashboard-summary. */
export interface DashboardSummary {
  totalApplications: number;
  avgMatchScore: number;
  resumesGenerated: number;
  gapReportsSaved: number;
  recentActivity: ApplicationListItem[];
  savedGapReports: SavedGapReportItem[];
}

import type {
  CreateJobDto,
  UpdateResumeSelectionDto,
  UpdateGapReportDto,
  UpdateEmailDraftDto,
} from '@resumiq/schemas';

// Response/request shapes reuse the same Zod-inferred types the backend
// validates against — `UpdateResumeSelectionDto` matches `AISelection`,
// `UpdateGapReportDto` matches `GapReport`, `UpdateEmailDraftDto` matches
// `EmailDraft` from @resumiq/ai-bridge (not a web dependency).
export type ResumeSelection = UpdateResumeSelectionDto;
export type GapReport = UpdateGapReportDto;
export type EmailDraft = UpdateEmailDraftDto;
export type JobFormValues = CreateJobDto;

// `SectionTypeSchema` isn't exported from @resumiq/schemas — derive the
// element type from the field that uses it instead of redeclaring the enum.
export type SectionType = ResumeSelection['section_order'][number];

/** SSE `done` payload from POST /api/applications/analyze/stream. */
export interface AnalyzeDoneEvent {
  applicationId: string;
  matchScore: number;
  reasons: string[];
  gapReport?: GapReport;
  selection?: ResumeSelection;
}

/** SSE `done` payload from POST /api/applications/:id/finalize/stream. */
export interface FinalizeDoneEvent {
  applicationId: string;
  pdfPath: string;
  emailDraft: EmailDraft;
}

/** Response of POST /api/applications/:id/render-preview. */
export interface RenderPreviewResult {
  pdf: string;
  pageCount: number;
}

/** Response of GET /api/applications/:id — the persisted Application row + its Job. */
export interface ApplicationRecord {
  id: string;
  matchScore: number;
  matchReasons: string[];
  status: string;
  gapReport: GapReport | null;
  resumeSelection: ResumeSelection | null;
  resumePdfPath: string | null;
  emailDraft: EmailDraft | null;
  job: {
    id: string;
    title: string;
    companyName: string;
  };
}

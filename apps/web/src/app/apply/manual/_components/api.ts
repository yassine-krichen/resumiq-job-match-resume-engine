import type { InterviewPrepIntakeAnswersDto } from '@resumiq/schemas';
import { apiFetch } from '@/lib/api';
import type {
  ApplicationRecord,
  EmailDraft,
  GapReport,
  InterviewPrepState,
  RenderPreviewResult,
  ResumeSelection,
} from './types';

export function getApplication(applicationId: string): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>(`/applications/${applicationId}`);
}

export function saveResumeSelection(
  applicationId: string,
  selection: ResumeSelection,
): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>(`/applications/${applicationId}/resume-selection`, {
    method: 'PATCH',
    body: JSON.stringify(selection),
  });
}

export function saveGapReport(
  applicationId: string,
  gapReport: GapReport,
): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>(`/applications/${applicationId}/gap-report`, {
    method: 'PATCH',
    body: JSON.stringify(gapReport),
  });
}

export function renderResumePreview(
  applicationId: string,
  selection: ResumeSelection,
): Promise<RenderPreviewResult> {
  return apiFetch<RenderPreviewResult>(`/applications/${applicationId}/render-preview`, {
    method: 'POST',
    body: JSON.stringify(selection),
  });
}

export function saveEmailDraft(
  applicationId: string,
  draft: EmailDraft,
): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>(`/applications/${applicationId}/email-draft`, {
    method: 'PATCH',
    body: JSON.stringify(draft),
  });
}

export function confirmApplication(applicationId: string): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>(`/applications/${applicationId}/confirm`, {
    method: 'POST',
  });
}

export function generateInterviewPrepIntake(applicationId: string): Promise<InterviewPrepState> {
  return apiFetch<InterviewPrepState>(`/applications/${applicationId}/interview-prep/intake`, {
    method: 'POST',
  });
}

export function updateInterviewPrepIntakeAnswers(
  applicationId: string,
  answers: InterviewPrepIntakeAnswersDto,
): Promise<InterviewPrepState> {
  return apiFetch<InterviewPrepState>(`/applications/${applicationId}/interview-prep/intake`, {
    method: 'PATCH',
    body: JSON.stringify(answers),
  });
}

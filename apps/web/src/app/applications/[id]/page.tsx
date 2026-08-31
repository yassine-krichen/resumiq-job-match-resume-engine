'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import { useFinalizeApplication } from '@/hooks/use-finalize-application';
import { useRegenerateApplication } from '@/hooks/use-regenerate-application';
import { Button } from '@/components/ui/button';
// Reused directly from /apply/manual — same review UI, whether the
// application was drafted mid-flow there or in the background via
// /discover's swipe-right pipeline.
import { getApplication } from '../../apply/manual/_components/api';
import { EmailReviewGate } from '../../apply/manual/_components/email-review-gate';
import { GapReportView } from '../../apply/manual/_components/gap-report-view';
import { MatchScoreDisplay } from '../../apply/manual/_components/match-score-display';
import { ResumeReviewEditor } from '../../apply/manual/_components/resume-review-editor';
import type { ApplicationRecord } from '../../apply/manual/_components/types';
import { InterviewPrepPanel } from './_components/interview-prep-panel';

type Step = 'gap' | 'review' | 'email' | 'ready';

function deriveStep(app: ApplicationRecord): Step | null {
  if (app.status === 'ready') return 'ready';
  if (app.emailDraft) return 'email';
  if (app.resumeSelection) return 'review';
  if (app.gapReport) return 'gap';
  return null;
}

/** "Re-check match & re-draft" at the gap-report step (regenerating can flip
 * a below-threshold job to an above-threshold one, or vice versa) —
 * "Re-generate resume draft" everywhere past that, where a fresh draft is
 * just a re-draft of the same resume/email content. */
function regenerateLabel(step: Step | null): string {
  return step === 'gap' ? 'Re-check match & re-draft' : 'Re-generate resume draft';
}

// picks the source file's extension from `renderedWith` ('latex' -> .tex,
// 'typst' -> .typ) — no new backend endpoint needed, `resumeSource` is
// already part of the fetched application row.
function downloadResumeSource(app: ApplicationRecord): void {
  if (!app.resumeSource) return;
  const extension = app.renderedWith === 'typst' ? 'typ' : 'tex';
  const blob = new Blob([app.resumeSource], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `resume.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ApplicationReviewPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const applicationId = params.id;

  const applicationQuery = useQuery({
    queryKey: ['application', applicationId],
    queryFn: () => getApplication(applicationId),
    enabled: Boolean(applicationId),
  });

  const { finalizing, progress, error, finalize } = useFinalizeApplication(applicationId ?? null);
  const {
    regenerating,
    progress: regenerateProgress,
    error: regenerateError,
    regenerate,
  } = useRegenerateApplication(applicationId ?? null);

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-12">
      {renderContent()}
    </div>
  );

  function renderContent(): React.JSX.Element {
    if (applicationQuery.isLoading) {
      return <p className="text-zinc-500">Loading application...</p>;
    }

    if (applicationQuery.isError) {
      return <p className="text-red-600">{(applicationQuery.error as Error).message}</p>;
    }

    const app = applicationQuery.data;
    if (!app) return <p className="text-zinc-500">Loading application...</p>;

    const step = deriveStep(app);
    const hasDownloads = (step === 'email' || step === 'ready') && Boolean(app.resumePdfPath);

    if (step === 'ready') {
      return (
        <div className="w-full max-w-2xl space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-semibold">Application ready</h1>
            <p className="mt-2 text-zinc-500">
              Your tailored resume and cold email draft for {app.job.title} @ {app.job.companyName}{' '}
              are ready. Send the email yourself when you&apos;re ready — this app never sends it
              for you.
            </p>
            {hasDownloads && <DownloadButtons app={app} />}
          </div>
          {renderRegenerateBar(step)}
          <InterviewPrepPanel applicationId={app.id} interviewPrep={app.interviewPrep} />
        </div>
      );
    }

    return (
      <div className="w-full max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-zinc-900">
            {app.job.title} @ {app.job.companyName}
          </h1>
          {renderRegenerateBar(step)}
        </div>

        {(step === 'gap' || step === 'review') && (
          <MatchScoreDisplay score={app.matchScore} reasons={app.matchReasons} />
        )}

        {step === 'gap' && app.gapReport && (
          <GapReportView applicationId={app.id} gapReport={app.gapReport} />
        )}

        {step === 'review' && app.resumeSelection && (
          <ResumeReviewEditor
            applicationId={app.id}
            selection={app.resumeSelection}
            onFinalize={finalize}
            finalizing={finalizing}
            progress={progress}
            error={error}
            disabled={regenerating}
          />
        )}

        {step === 'email' && app.emailDraft && (
          <>
            {hasDownloads && <DownloadButtons app={app} />}
            <EmailReviewGate applicationId={app.id} draft={app.emailDraft} />
            <InterviewPrepPanel applicationId={app.id} interviewPrep={app.interviewPrep} />
          </>
        )}

        {step === null && <p className="text-red-600">Unexpected application state.</p>}
      </div>
    );
  }

  function renderRegenerateBar(step: Step | null): React.JSX.Element {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={regenerate}
          disabled={regenerating || finalizing}
        >
          {regenerating ? regenerateProgress || 'Regenerating...' : regenerateLabel(step)}
        </Button>
        {regenerateError && <p className="text-xs text-red-600">{regenerateError}</p>}
      </div>
    );
  }
}

function DownloadButtons({ app }: { app: ApplicationRecord }): React.JSX.Element {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
      <a
        href={`${API_URL}/api/applications/${app.id}/resume.pdf`}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-zinc-900 underline underline-offset-4"
      >
        Download resume PDF
      </a>
      {app.resumeSource && (
        <button
          type="button"
          onClick={() => downloadResumeSource(app)}
          className="text-sm font-medium text-zinc-900 underline underline-offset-4"
        >
          Download resume source ({app.renderedWith === 'typst' ? '.typ' : '.tex'})
        </button>
      )}
    </div>
  );
}

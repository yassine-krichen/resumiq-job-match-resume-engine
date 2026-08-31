'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import { useFinalizeApplication } from '@/hooks/use-finalize-application';
// Reused directly from /apply/manual — same review UI, whether the
// application was drafted mid-flow there or in the background via
// /discover's swipe-right pipeline.
import { getApplication } from '../../apply/manual/_components/api';
import { EmailReviewGate } from '../../apply/manual/_components/email-review-gate';
import { GapReportView } from '../../apply/manual/_components/gap-report-view';
import { MatchScoreDisplay } from '../../apply/manual/_components/match-score-display';
import { ResumeReviewEditor } from '../../apply/manual/_components/resume-review-editor';
import type { ApplicationRecord } from '../../apply/manual/_components/types';

type Step = 'gap' | 'review' | 'email' | 'ready';

function deriveStep(app: ApplicationRecord): Step | null {
  if (app.status === 'ready') return 'ready';
  if (app.emailDraft) return 'email';
  if (app.resumeSelection) return 'review';
  if (app.gapReport) return 'gap';
  return null;
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

    if (step === 'ready') {
      return (
        <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Application ready</h1>
          <p className="mt-2 text-zinc-500">
            Your tailored resume and cold email draft for {app.job.title} @ {app.job.companyName}{' '}
            are ready. Send the email yourself when you&apos;re ready — this app never sends it
            for you.
          </p>
          <a
            href={`${API_URL}/api/applications/${app.id}/resume.pdf`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-sm font-medium text-zinc-900 underline underline-offset-4"
          >
            Download resume PDF
          </a>
        </div>
      );
    }

    return (
      <div className="w-full max-w-5xl space-y-6">
        <h1 className="text-xl font-semibold text-zinc-900">
          {app.job.title} @ {app.job.companyName}
        </h1>

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
          />
        )}

        {step === 'email' && app.emailDraft && (
          <EmailReviewGate applicationId={app.id} draft={app.emailDraft} />
        )}

        {step === null && <p className="text-red-600">Unexpected application state.</p>}
      </div>
    );
  }
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL, apiSSE } from '@/lib/api';
import { getApplication } from './api';
import { EmailReviewGate } from './email-review-gate';
import { GapReportView } from './gap-report-view';
import { JobDescriptionForm } from './job-description-form';
import { MatchScoreDisplay } from './match-score-display';
import { ResumeReviewEditor } from './resume-review-editor';
import type { AnalyzeDoneEvent, ApplicationRecord, JobFormValues } from './types';

type Step = 'gap' | 'review' | 'email' | 'ready';

function deriveStep(app: ApplicationRecord): Step | null {
  if (app.status === 'ready') return 'ready';
  if (app.emailDraft) return 'email';
  if (app.resumeSelection) return 'review';
  if (app.gapReport) return 'gap';
  return null;
}

export function ApplyManualFlow(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const applicationId = searchParams.get('applicationId');

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState('');
  const [analyzeError, setAnalyzeError] = useState('');

  const [finalizing, setFinalizing] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState('');
  const [finalizeError, setFinalizeError] = useState('');

  // Holds the cancel handle for whichever SSE stream (analyze/finalize) is
  // currently in flight, so navigating away or starting a new stream doesn't
  // leave the previous fetch/read loop running against an unmounted component.
  const cancelStreamRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cancelStreamRef.current?.();
  }, []);

  const applicationQuery = useQuery({
    queryKey: ['application', applicationId],
    queryFn: () => getApplication(applicationId as string),
    enabled: Boolean(applicationId),
  });

  function handleAnalyzeSubmit(dto: JobFormValues) {
    cancelStreamRef.current?.();
    setAnalyzing(true);
    setAnalyzeError('');
    setAnalyzeProgress('Starting...');

    cancelStreamRef.current = apiSSE('/applications/analyze/stream', dto, {
      onProgress: setAnalyzeProgress,
      onDone: (data) => {
        setAnalyzing(false);
        const result = data as AnalyzeDoneEvent;
        router.push(`/apply/manual?applicationId=${result.applicationId}`);
      },
      onError: (msg) => {
        setAnalyzing(false);
        setAnalyzeError(msg);
      },
    });
  }

  function handleFinalize() {
    if (!applicationId) return;
    cancelStreamRef.current?.();
    setFinalizing(true);
    setFinalizeError('');
    setFinalizeProgress('Starting...');

    cancelStreamRef.current = apiSSE(`/applications/${applicationId}/finalize/stream`, undefined, {
      onProgress: setFinalizeProgress,
      onDone: () => {
        setFinalizing(false);
        queryClient.invalidateQueries({ queryKey: ['application', applicationId] });
      },
      onError: (msg) => {
        setFinalizing(false);
        setFinalizeError(msg);
      },
    });
  }

  if (!applicationId) {
    return (
      <JobDescriptionForm
        onSubmit={handleAnalyzeSubmit}
        loading={analyzing}
        progress={analyzeProgress}
        error={analyzeError}
      />
    );
  }

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
          are ready. Send the email yourself when you&apos;re ready — this app never sends it for
          you.
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
          onFinalize={handleFinalize}
          finalizing={finalizing}
          progress={finalizeProgress}
          error={finalizeError}
        />
      )}

      {step === 'email' && app.emailDraft && (
        <EmailReviewGate applicationId={app.id} draft={app.emailDraft} />
      )}

      {step === null && <p className="text-red-600">Unexpected application state.</p>}
    </div>
  );
}

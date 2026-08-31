'use client';

import type { InterviewPrepReportDto } from '@resumiq/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useGenerateInterviewPrepReport } from '@/hooks/use-generate-interview-prep-report';
import { generateInterviewPrepIntake } from '../../../apply/manual/_components/api';
import type { InterviewPrepState } from '../../../apply/manual/_components/types';
import { InterviewPrepIntakeForm } from './interview-prep-intake-form';
import { InterviewPrepReport } from './interview-prep-report';

// Discriminated union so each step carries the already-narrowed data it
// needs — this lets the render logic below switch exhaustively without a
// "should be unreachable" fallback branch.
type InterviewPrepStepState =
  | { step: 'trigger' }
  | { step: 'intake'; interviewPrep: InterviewPrepState }
  | { step: 'awaiting-report'; interviewPrep: InterviewPrepState }
  | { step: 'report'; report: InterviewPrepReportDto };

// Mirrors deriveStep()'s shape on the parent page: derive which sub-step to
// render purely from the persisted `interviewPrep` state, no separate
// client-side step state to keep in sync.
function deriveInterviewPrepStep(
  interviewPrep: InterviewPrepState | null,
): InterviewPrepStepState {
  if (!interviewPrep) return { step: 'trigger' };
  if (interviewPrep.report) return { step: 'report', report: interviewPrep.report };
  if (interviewPrep.intake.answers) return { step: 'awaiting-report', interviewPrep };
  return { step: 'intake', interviewPrep };
}

interface InterviewPrepPanelProps {
  applicationId: string;
  interviewPrep: InterviewPrepState | null;
}

export function InterviewPrepPanel({
  applicationId,
  interviewPrep,
}: InterviewPrepPanelProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const { generating, progress, error: generateError, generate } =
    useGenerateInterviewPrepReport(applicationId);

  const intakeMutation = useMutation({
    mutationFn: () => generateInterviewPrepIntake(applicationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['application', applicationId] }),
  });

  const derived = deriveInterviewPrepStep(interviewPrep);

  switch (derived.step) {
    case 'trigger':
      return (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">Interview prep</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Generate a self-rating checklist and a few grounded questions to think through before
            your interview.
          </p>
          {intakeMutation.isError && (
            <p className="mt-2 text-sm text-red-600">{(intakeMutation.error as Error).message}</p>
          )}
          <div className="mt-4">
            <Button
              type="button"
              onClick={() => intakeMutation.mutate()}
              disabled={intakeMutation.isPending}
            >
              {intakeMutation.isPending ? 'Preparing...' : 'Prepare for interview'}
            </Button>
          </div>
        </div>
      );

    case 'intake':
      return (
        <InterviewPrepIntakeForm
          applicationId={applicationId}
          intake={derived.interviewPrep.intake}
          onSubmitted={generate}
          generating={generating}
          generateProgress={progress}
          generateError={generateError}
        />
      );

    case 'awaiting-report':
      return (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">Interview prep</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Your answers are saved. Generate the report whenever you&apos;re ready.
          </p>
          {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}
          <div className="mt-4">
            <Button type="button" onClick={generate} disabled={generating}>
              {generating ? progress || 'Generating report...' : 'Generate report'}
            </Button>
          </div>
        </div>
      );

    case 'report':
      return <InterviewPrepReport report={derived.report} />;
  }
}

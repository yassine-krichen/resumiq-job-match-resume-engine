import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InterviewPrepPanel } from './interview-prep-panel';
import { generateInterviewPrepIntake } from '../../../apply/manual/_components/api';
import {
  buildInterviewPrepIntakeAnswers,
  buildInterviewPrepIntakeState,
  buildInterviewPrepReport,
  buildInterviewPrepState,
} from '../../../apply/manual/_components/test-fixtures';
import type { InterviewPrepIntakeState } from '../../../apply/manual/_components/types';

// `../../../apply/manual/_components/api` also exports
// `updateInterviewPrepIntakeAnswers`, used by `InterviewPrepIntakeForm` — not
// stubbed here since that form is mocked by name below.
vi.mock('../../../apply/manual/_components/api', () => ({
  generateInterviewPrepIntake: vi.fn(),
}));

// The SSE report-generation hook has its own direct test suite
// (src/hooks/use-generate-interview-prep-report.test.tsx) — stubbed here so
// this suite stays focused on `deriveInterviewPrepStep()`'s routing, not SSE
// plumbing. Mutable via `vi.hoisted` so individual tests can drive
// generating/progress/error and assert `generate` gets called.
const generateState = vi.hoisted(() => ({
  generating: false,
  progress: '',
  error: '',
  generate: vi.fn(),
}));
vi.mock('@/hooks/use-generate-interview-prep-report', () => ({
  useGenerateInterviewPrepReport: () => generateState,
}));

// Both child steps have their own dedicated test files — stubbed here so
// this suite only asserts they're mounted with the right props, not their
// internals.
vi.mock('./interview-prep-intake-form', () => ({
  InterviewPrepIntakeForm: ({
    intake,
    generating,
    generateProgress,
    generateError,
    onSubmitted,
  }: {
    intake: InterviewPrepIntakeState;
    generating: boolean;
    generateProgress: string;
    generateError: string;
    onSubmitted: () => void;
  }) => (
    <div>
      interview-prep-intake-form-stub (weak topics: {intake.weak_topics.join(', ')}, generating:{' '}
      {String(generating)}, progress: {generateProgress}, error: {generateError})
      <button type="button" onClick={onSubmitted}>
        fire-onSubmitted
      </button>
    </div>
  ),
}));
vi.mock('./interview-prep-report', () => ({
  InterviewPrepReport: ({ report }: { report: { technical_topics: { topic: string }[] } }) => (
    <div>interview-prep-report-stub (topics: {report.technical_topics.map((t) => t.topic).join(', ')})</div>
  ),
}));

function renderPanel(interviewPrep: Parameters<typeof InterviewPrepPanel>[0]['interviewPrep']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <InterviewPrepPanel applicationId="app-1" interviewPrep={interviewPrep} />
    </QueryClientProvider>,
  );
  return { invalidateSpy, ...utils };
}

describe('InterviewPrepPanel', () => {
  beforeEach(() => {
    vi.mocked(generateInterviewPrepIntake).mockReset();
    generateState.generating = false;
    generateState.progress = '';
    generateState.error = '';
    generateState.generate.mockReset();
  });

  describe('deriveInterviewPrepStep — trigger', () => {
    it('shows the "Prepare for interview" trigger when interviewPrep is null', () => {
      renderPanel(null);

      expect(screen.getByRole('heading', { name: 'Interview prep' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Prepare for interview' })).toBeInTheDocument();
      expect(screen.queryByText(/interview-prep-intake-form-stub/)).not.toBeInTheDocument();
      expect(screen.queryByText(/interview-prep-report-stub/)).not.toBeInTheDocument();
    });

    it('calls generateInterviewPrepIntake for the current application when the trigger button is clicked', async () => {
      vi.mocked(generateInterviewPrepIntake).mockResolvedValue(buildInterviewPrepState());
      renderPanel(null);

      fireEvent.click(screen.getByRole('button', { name: 'Prepare for interview' }));

      await waitFor(() => expect(generateInterviewPrepIntake).toHaveBeenCalledWith('app-1'));
    });

    it('disables the trigger button and shows "Preparing..." while the intake request is in flight', async () => {
      vi.mocked(generateInterviewPrepIntake).mockReturnValue(new Promise(() => {}));
      renderPanel(null);

      fireEvent.click(screen.getByRole('button', { name: 'Prepare for interview' }));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Preparing...' })).toBeDisabled(),
      );
    });

    it('invalidates the application query once the intake request succeeds', async () => {
      vi.mocked(generateInterviewPrepIntake).mockResolvedValue(buildInterviewPrepState());
      const { invalidateSpy } = renderPanel(null);

      fireEvent.click(screen.getByRole('button', { name: 'Prepare for interview' }));

      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['application', 'app-1'] }),
      );
    });

    it('shows the error message when the intake request fails', async () => {
      vi.mocked(generateInterviewPrepIntake).mockRejectedValue(new Error('API 500: intake failed'));
      renderPanel(null);

      fireEvent.click(screen.getByRole('button', { name: 'Prepare for interview' }));

      await waitFor(() => expect(screen.getByText('API 500: intake failed')).toBeInTheDocument());
    });
  });

  describe('deriveInterviewPrepStep — intake', () => {
    it('renders the intake form when the intake has no saved answers yet', () => {
      const interviewPrep = buildInterviewPrepState();

      renderPanel(interviewPrep);

      expect(screen.getByText(/interview-prep-intake-form-stub/)).toBeInTheDocument();
      expect(screen.getByText(/weak topics: Kubernetes, System design/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Prepare for interview' })).not.toBeInTheDocument();
      expect(screen.queryByText(/interview-prep-report-stub/)).not.toBeInTheDocument();
    });

    it('threads the report-generation hook state down to the intake form', () => {
      generateState.generating = true;
      generateState.progress = 'Synthesizing report...';
      generateState.error = 'HTTP 500';

      renderPanel(buildInterviewPrepState());

      expect(
        screen.getByText(/generating: true, progress: Synthesizing report\.\.\., error: HTTP 500/),
      ).toBeInTheDocument();
    });

    it('calls generate() when the intake form reports it submitted successfully', () => {
      renderPanel(buildInterviewPrepState());

      fireEvent.click(screen.getByRole('button', { name: 'fire-onSubmitted' }));

      expect(generateState.generate).toHaveBeenCalledTimes(1);
    });
  });

  describe('deriveInterviewPrepStep — awaiting-report', () => {
    function awaitingReport() {
      return buildInterviewPrepState({
        intake: buildInterviewPrepIntakeState({ answers: buildInterviewPrepIntakeAnswers() }),
      });
    }

    it('shows the "Generate report" prompt once intake answers are saved but no report exists yet', () => {
      renderPanel(awaitingReport());

      expect(
        screen.getByText(/Your answers are saved\. Generate the report whenever/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate report' })).toBeInTheDocument();
      expect(screen.queryByText(/interview-prep-intake-form-stub/)).not.toBeInTheDocument();
    });

    it('calls generate() when "Generate report" is clicked', () => {
      renderPanel(awaitingReport());

      fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));

      expect(generateState.generate).toHaveBeenCalledTimes(1);
    });

    it('shows the in-progress message and disables the button while generating', () => {
      generateState.generating = true;
      generateState.progress = 'Synthesizing report...';

      renderPanel(awaitingReport());

      expect(screen.getByRole('button', { name: 'Synthesizing report...' })).toBeDisabled();
    });

    it('shows the generate error message when report generation fails', () => {
      generateState.error = 'HTTP 500';

      renderPanel(awaitingReport());

      expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    });
  });

  describe('deriveInterviewPrepStep — report', () => {
    it('renders the report view once a report exists, regardless of intake contents', () => {
      const interviewPrep = buildInterviewPrepState({
        intake: buildInterviewPrepIntakeState({ answers: buildInterviewPrepIntakeAnswers() }),
        report: buildInterviewPrepReport({
          technical_topics: [{ topic: 'System design', probability: 'high', reasoning: 'x' }],
        }),
      });

      renderPanel(interviewPrep);

      expect(screen.getByText(/interview-prep-report-stub/)).toBeInTheDocument();
      expect(screen.getByText(/topics: System design/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Prepare for interview' })).not.toBeInTheDocument();
      expect(screen.queryByText(/interview-prep-intake-form-stub/)).not.toBeInTheDocument();
    });
  });
});

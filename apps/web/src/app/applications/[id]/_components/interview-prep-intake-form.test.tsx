import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import type { InterviewPrepIntakeAnswersDto } from '@resumiq/schemas';
import { InterviewPrepIntakeForm } from './interview-prep-intake-form';
import { updateInterviewPrepIntakeAnswers } from '../../../apply/manual/_components/api';
import {
  buildInterviewPrepIntakeState,
  buildInterviewPrepState,
} from '../../../apply/manual/_components/test-fixtures';

vi.mock('../../../apply/manual/_components/api', () => ({
  updateInterviewPrepIntakeAnswers: vi.fn(),
}));

function renderForm({
  intake = buildInterviewPrepIntakeState(),
  onSubmitted = vi.fn(),
  generating = false,
  generateProgress = '',
  generateError = '',
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <InterviewPrepIntakeForm
        applicationId="app-1"
        intake={intake}
        onSubmitted={onSubmitted}
        generating={generating}
        generateProgress={generateProgress}
        generateError={generateError}
      />
    </QueryClientProvider>,
  );
  return { onSubmitted, invalidateSpy };
}

function submittedPayload(): InterviewPrepIntakeAnswersDto {
  return vi.mocked(updateInterviewPrepIntakeAnswers).mock.calls[0][1];
}

describe('InterviewPrepIntakeForm', () => {
  beforeEach(() => {
    vi.mocked(updateInterviewPrepIntakeAnswers).mockReset();
    vi.mocked(updateInterviewPrepIntakeAnswers).mockResolvedValue(buildInterviewPrepState());
  });

  it('renders a checkbox for each weak topic and a textarea for each dynamic question', () => {
    renderForm({
      intake: buildInterviewPrepIntakeState({
        weak_topics: ['Kubernetes', 'System design'],
        questions: [
          { question: 'Why this company?', reasoning: 'Tests culture fit.' },
          { question: 'Describe a scaling challenge.', reasoning: 'Probes depth.' },
        ],
      }),
    });

    expect(screen.getByRole('checkbox', { name: 'Kubernetes' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'System design' })).toBeInTheDocument();
    expect(screen.getByLabelText('Why this company?')).toBeInTheDocument();
    expect(screen.getByLabelText('Describe a scaling challenge.')).toBeInTheDocument();
  });

  it('omits the weak-topics section when there are no weak topics', () => {
    renderForm({ intake: buildInterviewPrepIntakeState({ weak_topics: [] }) });

    expect(screen.queryByText('Self-rate your weak spots')).not.toBeInTheDocument();
  });

  it('omits the dynamic questions section when there are no questions', () => {
    renderForm({ intake: buildInterviewPrepIntakeState({ questions: [] }) });

    expect(screen.queryByText('Questions to think through')).not.toBeInTheDocument();
  });

  it('includes only the checked weak topics in weak_topics_selected on submit', async () => {
    renderForm({
      intake: buildInterviewPrepIntakeState({ weak_topics: ['Kubernetes', 'System design'] }),
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Kubernetes' }));
    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() => expect(updateInterviewPrepIntakeAnswers).toHaveBeenCalledTimes(1));
    expect(submittedPayload().weak_topics_selected).toEqual(['Kubernetes']);
  });

  it('unchecking a previously checked weak topic removes it from weak_topics_selected', async () => {
    renderForm({ intake: buildInterviewPrepIntakeState({ weak_topics: ['Kubernetes'] }) });

    const checkbox = screen.getByRole('checkbox', { name: 'Kubernetes' });
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() => expect(updateInterviewPrepIntakeAnswers).toHaveBeenCalledTimes(1));
    expect(submittedPayload().weak_topics_selected).toEqual([]);
  });

  it('maps each dynamic question textarea to its own entry in dynamic_question_answers', async () => {
    renderForm({
      intake: buildInterviewPrepIntakeState({
        questions: [
          { question: 'Why this company?', reasoning: 'Tests culture fit.' },
          { question: 'Describe a scaling challenge.', reasoning: 'Probes depth.' },
        ],
      }),
    });

    fireEvent.change(screen.getByLabelText('Why this company?'), {
      target: { value: 'Their mission aligns with my values.' },
    });
    fireEvent.change(screen.getByLabelText('Describe a scaling challenge.'), {
      target: { value: 'Scaled the payments pipeline 10x.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() => expect(updateInterviewPrepIntakeAnswers).toHaveBeenCalledTimes(1));
    expect(submittedPayload().dynamic_question_answers).toEqual([
      { question: 'Why this company?', answer: 'Their mission aligns with my values.' },
      { question: 'Describe a scaling challenge.', answer: 'Scaled the payments pipeline 10x.' },
    ]);
  });

  it('submits an empty answer for a dynamic question left blank', async () => {
    renderForm({
      intake: buildInterviewPrepIntakeState({
        questions: [{ question: 'Why this company?', reasoning: 'Tests culture fit.' }],
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() => expect(updateInterviewPrepIntakeAnswers).toHaveBeenCalledTimes(1));
    expect(submittedPayload().dynamic_question_answers).toEqual([
      { question: 'Why this company?', answer: '' },
    ]);
  });

  it('assembles the interview format, interviewers, and concerns fields into the submitted payload', async () => {
    renderForm({ intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }) });

    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'panel' } });
    fireEvent.change(screen.getByLabelText('Interviewers (optional)'), {
      target: { value: 'Two senior engineers' },
    });
    fireEvent.change(screen.getByLabelText(/Anything you're worried about/), {
      target: { value: 'Live coding under pressure' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() => expect(updateInterviewPrepIntakeAnswers).toHaveBeenCalledTimes(1));
    expect(submittedPayload()).toEqual({
      interview_format: 'panel',
      interviewers: 'Two senior engineers',
      concerns: 'Live coding under pressure',
      weak_topics_selected: [],
      dynamic_question_answers: [],
    });
  });

  it('omits interviewers and concerns from the payload when left blank', async () => {
    renderForm({ intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }) });

    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() => expect(updateInterviewPrepIntakeAnswers).toHaveBeenCalledTimes(1));
    expect(submittedPayload().interviewers).toBeUndefined();
    expect(submittedPayload().concerns).toBeUndefined();
  });

  it('saves against the given applicationId', async () => {
    renderForm({ intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }) });

    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() =>
      expect(updateInterviewPrepIntakeAnswers).toHaveBeenCalledWith('app-1', expect.anything()),
    );
  });

  it('invalidates the application query once the save succeeds', async () => {
    const { invalidateSpy } = renderForm({
      intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }),
    });

    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['application', 'app-1'] }),
    );
  });

  it('chains into report generation by calling onSubmitted once the save succeeds', async () => {
    const { onSubmitted } = renderForm({
      intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }),
    });

    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  });

  it('does not call onSubmitted and shows the error message when saving the intake answers fails', async () => {
    vi.mocked(updateInterviewPrepIntakeAnswers).mockRejectedValue(
      new Error('API 500: could not save intake'),
    );
    const { onSubmitted } = renderForm({
      intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }),
    });

    fireEvent.click(screen.getByRole('button', { name: /submit & generate report/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save intake')).toBeInTheDocument(),
    );
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('shows the generate error message passed down from the panel, alongside any save error', () => {
    renderForm({
      intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }),
      generateError: 'HTTP 500',
    });

    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
  });

  it('shows the report-generation progress on the submit button while generating', () => {
    renderForm({
      intake: buildInterviewPrepIntakeState({ weak_topics: [], questions: [] }),
      generating: true,
      generateProgress: 'Synthesizing report...',
    });

    expect(screen.getByRole('button', { name: 'Synthesizing report...' })).toBeDisabled();
  });
});

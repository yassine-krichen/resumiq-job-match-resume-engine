'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InterviewPrepIntakeAnswersDto } from '@resumiq/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateInterviewPrepIntakeAnswers } from '../../../apply/manual/_components/api';
import type { InterviewPrepIntakeState } from '../../../apply/manual/_components/types';

const INTERVIEW_FORMATS: Array<{ value: InterviewPrepIntakeAnswersDto['interview_format']; label: string }> = [
  { value: 'unknown', label: "Don't know yet" },
  { value: 'one_on_one', label: 'One-on-one' },
  { value: 'panel', label: 'Panel' },
];

interface InterviewPrepIntakeFormProps {
  applicationId: string;
  intake: InterviewPrepIntakeState;
  /** Called once the answers are saved — the panel chains straight into
   * report generation, same "save then trigger the SSE stream" pattern as
   * ResumeReviewEditor's Confirm & continue. */
  onSubmitted: () => void;
  generating: boolean;
  generateProgress: string;
  generateError: string;
}

export function InterviewPrepIntakeForm({
  applicationId,
  intake,
  onSubmitted,
  generating,
  generateProgress,
  generateError,
}: InterviewPrepIntakeFormProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [weakTopicsSelected, setWeakTopicsSelected] = useState<string[]>([]);
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const [interviewFormat, setInterviewFormat] =
    useState<InterviewPrepIntakeAnswersDto['interview_format']>('unknown');
  const [interviewers, setInterviewers] = useState('');
  const [concerns, setConcerns] = useState('');

  const mutation = useMutation({
    mutationFn: (answers: InterviewPrepIntakeAnswersDto) =>
      updateInterviewPrepIntakeAnswers(applicationId, answers),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['application', applicationId] }),
  });

  function toggleWeakTopic(topic: string, checked: boolean) {
    setWeakTopicsSelected((prev) =>
      checked ? [...prev, topic] : prev.filter((t) => t !== topic),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const answers: InterviewPrepIntakeAnswersDto = {
      interview_format: interviewFormat,
      interviewers: interviewers.trim() || undefined,
      concerns: concerns.trim() || undefined,
      weak_topics_selected: weakTopicsSelected,
      dynamic_question_answers: intake.questions.map(({ question }) => ({
        question,
        answer: answersByQuestion[question] ?? '',
      })),
    };

    try {
      await mutation.mutateAsync(answers);
      onSubmitted();
    } catch {
      // Save failed — mutation.isError renders the message below; stay on this step.
    }
  }

  const submitting = mutation.isPending || generating;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {intake.weak_topics.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-1 text-base font-semibold">Self-rate your weak spots</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Check any of this role&apos;s required skills you&apos;re less confident on — the
            report will focus extra prep there.
          </p>
          <ul className="space-y-2">
            {intake.weak_topics.map((topic) => (
              <li key={topic} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`weak-topic-${topic}`}
                  checked={weakTopicsSelected.includes(topic)}
                  onChange={(e) => toggleWeakTopic(topic, e.target.checked)}
                  disabled={submitting}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor={`weak-topic-${topic}`}>{topic}</Label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {intake.questions.length > 0 && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">Questions to think through</h2>
          {intake.questions.map(({ question, reasoning }) => (
            <div key={question}>
              <Label htmlFor={`question-${question}`}>{question}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{reasoning}</p>
              <Textarea
                id={`question-${question}`}
                value={answersByQuestion[question] ?? ''}
                onChange={(e) =>
                  setAnswersByQuestion((prev) => ({ ...prev, [question]: e.target.value }))
                }
                disabled={submitting}
                rows={3}
                className="mt-1"
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Interview context</h2>
        <div>
          <Label htmlFor="interview-format">Format</Label>
          <select
            id="interview-format"
            value={interviewFormat}
            onChange={(e) =>
              setInterviewFormat(e.target.value as InterviewPrepIntakeAnswersDto['interview_format'])
            }
            disabled={submitting}
            className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {INTERVIEW_FORMATS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="interviewers">Interviewers (optional)</Label>
          <Input
            id="interviewers"
            value={interviewers}
            onChange={(e) => setInterviewers(e.target.value)}
            disabled={submitting}
            placeholder="e.g. Engineering manager, two senior engineers"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="concerns">Anything you&apos;re worried about? (optional)</Label>
          <Textarea
            id="concerns"
            value={concerns}
            onChange={(e) => setConcerns(e.target.value)}
            disabled={submitting}
            rows={3}
            className="mt-1"
          />
        </div>
      </div>

      {mutation.isError && (
        <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
      )}
      {generateError && <p className="text-sm text-red-600">{generateError}</p>}

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={submitting}>
          {generating
            ? generateProgress || 'Generating report...'
            : mutation.isPending
              ? 'Saving...'
              : 'Submit & generate report'}
        </Button>
      </div>
    </form>
  );
}

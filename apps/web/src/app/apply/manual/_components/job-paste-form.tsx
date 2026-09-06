'use client';

import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { extractJobIntake } from './api';
import type { JobIntakeResult } from './types';

const MIN_PASTE_LENGTH = 50;

interface JobPasteFormProps {
  /** Called once extraction succeeds — hands off the raw paste and the
   * extracted metadata to the review step. */
  onExtracted: (rawText: string, result: JobIntakeResult) => void;
  /** Called when the user opts to skip extraction (either up front, or after
   * an extraction failure) and go straight to a blank structured review form. */
  onManualFallback: (rawText: string) => void;
}

export function JobPasteForm({
  onExtracted,
  onManualFallback,
}: JobPasteFormProps): React.JSX.Element {
  const [rawText, setRawText] = useState('');

  const mutation = useMutation({
    mutationFn: (text: string) => extractJobIntake(text),
  });

  const canSubmit = rawText.trim().length >= MIN_PASTE_LENGTH;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || mutation.isPending) return;

    try {
      const result = await mutation.mutateAsync(rawText);
      onExtracted(rawText, result);
    } catch {
      // Extraction failed — mutation.isError renders the message and the
      // "fill in manually" fallback below; stay on this step.
    }
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Analyze a job description</h1>
        <p className="mt-1 text-zinc-500">
          Paste the job posting — optionally with any company profile info glued in. We&apos;ll
          extract the job details, then score your fit against your career profile.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
          <Label htmlFor="raw-paste">Job posting</Label>
          <Textarea
            id="raw-paste"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the full job posting here..."
            rows={16}
            className="mt-1 font-mono text-sm"
            disabled={mutation.isPending}
          />
        </div>

        {mutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-800" />
            Analyzing...
          </div>
        )}

        {mutation.isError && (
          <div className="space-y-2">
            <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => onManualFallback(rawText)}
            >
              Fill in manually instead
            </Button>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            Analyze job
          </Button>
        </div>
      </form>
    </div>
  );
}

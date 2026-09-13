'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { JobFormValues, JobIntakeResult } from './types';

interface JobIntakeReviewFormProps {
  /** Extracted metadata to pre-fill from, or null when arriving via the
   * manual-fallback path — every field then starts blank. */
  initial: JobIntakeResult | null;
  /** The original untouched paste — shown read-only for reference and sent
   * as `raw_jd` on submit, unedited. */
  rawText: string;
  onBack: () => void;
  onSubmit: (dto: JobFormValues) => void;
  loading: boolean;
  progress: string;
  error: string;
}

export function JobIntakeReviewForm({
  initial,
  rawText,
  onBack,
  onSubmit,
  loading,
  progress,
  error,
}: JobIntakeReviewFormProps): React.JSX.Element {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [companyName, setCompanyName] = useState(initial?.company_name ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [remote, setRemote] = useState(initial?.remote ?? false);
  const [salaryRange, setSalaryRange] = useState(initial?.salary_range ?? '');
  const [sourceUrl, setSourceUrl] = useState('');
  const [companyInfo, setCompanyInfo] = useState(initial?.company_info_summary ?? '');

  const canSubmit = companyName.trim().length > 0;
  const looksUnlikeAJobPosting = initial !== null && !initial.title && !initial.company_name;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    onSubmit({
      raw_jd: rawText,
      company_info: companyInfo.trim() || undefined,
      pages: 2,
      source_url: sourceUrl.trim() || undefined,
      title: title.trim() || undefined,
      company_name: companyName.trim(),
      location: location.trim() || undefined,
      remote,
      salary_range: salaryRange.trim() || undefined,
    });
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Review job details</h1>
        <p className="mt-1 text-muted-foreground">
          Check the extracted details below, fill in anything missing, then confirm to score your
          fit and draft your resume.
        </p>
      </div>

      {looksUnlikeAJobPosting && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This doesn&apos;t look like a job posting — double check the pasted text. You can still
          fill in the fields manually and submit.
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="job-title">Job title</Label>
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              className="mt-1"
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="company-name">
              Company name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="mt-1"
              disabled={loading}
              required
            />
          </div>
          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1"
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="salary-range">Salary range</Label>
            <Input
              id="salary-range"
              value={salaryRange}
              onChange={(e) => setSalaryRange(e.target.value)}
              placeholder="e.g. $140k–$170k"
              className="mt-1"
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="source-url">Source URL</Label>
            <Input
              id="source-url"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1"
              disabled={loading}
            />
          </div>
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={remote}
              onChange={(e) => setRemote(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-input"
            />
            Remote
          </label>
        </div>

        <div>
          <Label htmlFor="company-info">Company info / notes (optional)</Label>
          <Textarea
            id="company-info"
            value={companyInfo}
            onChange={(e) => setCompanyInfo(e.target.value)}
            placeholder="Anything about the company's tone, values, or culture that should inform the resume and cold email"
            rows={3}
            className="mt-1"
            disabled={loading}
          />
        </div>

        <details className="rounded-lg border border-border bg-muted p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            View original pasted text
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {rawText}
          </pre>
        </details>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
            {progress}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button type="submit" disabled={!canSubmit || loading}>
            Confirm & score
          </Button>
        </div>
      </form>
    </div>
  );
}

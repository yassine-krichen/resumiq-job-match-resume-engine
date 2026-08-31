'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { JobFormValues } from './types';

const MIN_JD_LENGTH = 50;

interface JobDescriptionFormProps {
  onSubmit: (dto: JobFormValues) => void;
  loading: boolean;
  progress: string;
  error: string;
}

export function JobDescriptionForm({
  onSubmit,
  loading,
  progress,
  error,
}: JobDescriptionFormProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [location, setLocation] = useState('');
  const [remote, setRemote] = useState(false);
  const [salaryRange, setSalaryRange] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [companyInfo, setCompanyInfo] = useState('');
  const [rawJd, setRawJd] = useState('');

  const canSubmit = companyName.trim().length > 0 && rawJd.trim().length >= MIN_JD_LENGTH;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    onSubmit({
      raw_jd: rawJd,
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
        <h1 className="text-2xl font-bold">Analyze a job description</h1>
        <p className="mt-1 text-zinc-500">
          Paste the job description. We&apos;ll score your fit against your career profile and
          either draft a tailored resume or a gap report.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
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
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={remote}
              onChange={(e) => setRemote(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-zinc-300"
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

        <div>
          <Label htmlFor="raw-jd">Job description</Label>
          <Textarea
            id="raw-jd"
            value={rawJd}
            onChange={(e) => setRawJd(e.target.value)}
            placeholder="Paste the full job description here..."
            rows={14}
            className="mt-1 font-mono text-sm"
            disabled={loading}
          />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-800" />
            {progress}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit || loading}>
            Analyze job
          </Button>
        </div>
      </form>
    </div>
  );
}

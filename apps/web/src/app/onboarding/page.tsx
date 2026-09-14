'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIngestCareerText } from '@/hooks/use-ingest-career-text';

// Mirrors the server-side cap on IngestBodySchema.raw_text (packages/schemas)
// — kept in sync manually since the frontend doesn't import backend schemas.
const RAW_TEXT_MAX_LENGTH = 20000;

export default function OnboardingPage() {
  const router = useRouter();
  const [rawText, setRawText] = useState('');
  const { loading, progress, error, parseSummary, ingest } = useIngestCareerText();

  function handleSubmit() {
    if (!rawText.trim()) return;
    ingest(rawText);
  }

  // Once the stream reports done with nothing dropped, move straight to
  // review — the banner below only needs to hold the user back when some
  // pasted items didn't make it into their profile.
  useEffect(() => {
    if (parseSummary && parseSummary.dropped === 0) {
      router.push('/onboarding/review');
    }
  }, [parseSummary, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Add your career experience</h1>
          <p className="mt-1 text-muted-foreground">
            Paste any raw text — a job description of what you did, LinkedIn summary,
            resume section, project write-up, or freeform notes. AI will parse and
            extract it into your profile.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`Example:\n\nSoftware Engineer at Acme Corp (Jan 2023 – Jun 2024)\n- Built a real-time notification system using NestJS and Redis that handled 50k events/day\n- Reduced API response time by 40% through query optimization\nStack: TypeScript, NestJS, PostgreSQL, Redis, Docker`}
            rows={14}
            maxLength={RAW_TEXT_MAX_LENGTH}
            className="w-full resize-none rounded-lg border border-border p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={loading}
          />

          {loading && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
              {progress}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}

          {parseSummary && parseSummary.dropped > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700">
              <p>
                {parseSummary.parsed} item{parseSummary.parsed === 1 ? '' : 's'} parsed,{' '}
                {parseSummary.dropped} couldn&apos;t be extracted.
              </p>
              <button
                onClick={() => router.push('/onboarding/review')}
                className="mt-2 font-medium underline underline-offset-4"
              >
                Continue to review
              </button>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => router.push('/profile')}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </button>
            <button
              onClick={handleSubmit}
              disabled={!rawText.trim() || loading}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Parse & add to profile
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          You can add multiple entries — come back to this page anytime.
        </p>
      </div>
    </div>
  );
}

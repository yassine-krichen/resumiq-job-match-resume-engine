'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiSSE } from '@/lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  const [rawText, setRawText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  function handleSubmit() {
    if (!rawText.trim()) return;
    setStatus('loading');
    setProgress('Starting...');

    apiSSE(
      '/onboarding/ingest/stream',
      { raw_text: rawText },
      {
        onProgress: (step) => setProgress(step),
        onDone: () => {
          setStatus('done');
          router.push('/onboarding/review');
        },
        onError: (msg) => {
          setError(msg);
          setStatus('error');
        },
      },
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Add your career experience</h1>
          <p className="mt-1 text-zinc-500">
            Paste any raw text — a job description of what you did, LinkedIn summary,
            resume section, project write-up, or freeform notes. AI will parse and
            extract it into your profile.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`Example:\n\nSoftware Engineer at Acme Corp (Jan 2023 – Jun 2024)\n- Built a real-time notification system using NestJS and Redis that handled 50k events/day\n- Reduced API response time by 40% through query optimization\nStack: TypeScript, NestJS, PostgreSQL, Redis, Docker`}
            rows={14}
            className="w-full resize-none rounded-lg border border-zinc-200 p-4 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            disabled={status === 'loading'}
          />

          {status === 'loading' && (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-800" />
              {progress}
            </div>
          )}

          {status === 'error' && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => router.push('/profile')}
              className="text-sm text-zinc-400 hover:text-zinc-700"
            >
              Skip for now
            </button>
            <button
              onClick={handleSubmit}
              disabled={!rawText.trim() || status === 'loading'}
              className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Parse & add to profile
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-400">
          You can add multiple entries — come back to this page anytime.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { apiSSE } from '@/lib/api';

export interface IngestParseSummary {
  parsed: number;
  dropped: number;
}

interface UseIngestCareerTextResult {
  loading: boolean;
  progress: string;
  error: string;
  /** Populated once the stream reports done — null until then, and reset on
   * every new `ingest()` call. */
  parseSummary: IngestParseSummary | null;
  ingest: (rawText: string) => void;
}

/**
 * Triggers POST /api/onboarding/ingest/stream and tracks its SSE progress —
 * same progress/done/error framing as `useFinalizeApplication`, pointed at
 * the onboarding ingest endpoint instead. Used by /onboarding to parse a
 * pasted block of raw career text into the profile.
 */
export function useIngestCareerText(): UseIngestCareerTextResult {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [parseSummary, setParseSummary] = useState<IngestParseSummary | null>(null);

  // Holds the cancel handle for the in-flight ingest SSE stream, so
  // navigating away or re-triggering ingest doesn't leave the previous
  // fetch/read loop running against an unmounted component.
  const cancelStreamRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cancelStreamRef.current?.();
  }, []);

  function ingest(rawText: string) {
    cancelStreamRef.current?.();
    setLoading(true);
    setError('');
    setProgress('Starting...');
    setParseSummary(null);

    cancelStreamRef.current = apiSSE(
      '/onboarding/ingest/stream',
      { raw_text: rawText },
      {
        onProgress: setProgress,
        onDone: (data) => {
          const { parsed = [], droppedCount = 0 } = data as {
            parsed?: unknown[];
            droppedCount?: number;
          };
          setLoading(false);
          setParseSummary({ parsed: parsed.length, dropped: droppedCount });
        },
        onError: (msg) => {
          setLoading(false);
          setError(msg);
        },
      },
    );
  }

  return { loading, progress, error, parseSummary, ingest };
}

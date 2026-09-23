'use client';

import { useEffect, useRef, useState } from 'react';
import { apiSSE } from '@/lib/api';
import type { IngestDraftEntryDto } from '@resumiq/schemas';

export interface IngestDroppedEntrySummary {
  type: string;
  reason: string;
  snippet: string;
}

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
  /** The AI-extracted drafts from the last completed parse — includes
   * complete entries and incomplete-but-editable ones (see `missingFields`).
   * Parsed, not yet persisted. `/onboarding/review` reads this to let the
   * user confirm/edit/reject before it's written via
   * `POST /onboarding/ingest/confirm`. */
  entries: IngestDraftEntryDto[];
  /** Entries the AI returned that couldn't be recovered even as an
   * incomplete draft (unrecognized type, or failed lenient validation). */
  droppedEntries: IngestDroppedEntrySummary[];
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
  const [entries, setEntries] = useState<IngestDraftEntryDto[]>([]);
  const [droppedEntries, setDroppedEntries] = useState<IngestDroppedEntrySummary[]>([]);

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
    setEntries([]);
    setDroppedEntries([]);

    cancelStreamRef.current = apiSSE(
      '/onboarding/ingest/stream',
      { raw_text: rawText },
      {
        onProgress: setProgress,
        onDone: (data) => {
          const { parsed = [], droppedEntries: dropped = [] } = data as {
            parsed?: IngestDraftEntryDto[];
            droppedEntries?: IngestDroppedEntrySummary[];
          };
          setLoading(false);
          setEntries(parsed);
          setDroppedEntries(dropped);
          setParseSummary({ parsed: parsed.length, dropped: dropped.length });
        },
        onError: (msg) => {
          setLoading(false);
          setError(msg);
        },
      },
    );
  }

  return { loading, progress, error, parseSummary, entries, droppedEntries, ingest };
}

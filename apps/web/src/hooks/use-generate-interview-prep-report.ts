'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiSSE } from '@/lib/api';

interface UseGenerateInterviewPrepReportResult {
  generating: boolean;
  progress: string;
  error: string;
  generate: () => void;
}

/**
 * Triggers POST /api/applications/:id/interview-prep/generate/stream and
 * tracks its SSE progress — same progress/done/error framing as
 * `useFinalizeApplication`/`useRegenerateApplication`, pointed at the
 * interview-prep report synthesis endpoint instead.
 */
export function useGenerateInterviewPrepReport(
  applicationId: string | null,
): UseGenerateInterviewPrepReportResult {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  // Holds the cancel handle for the in-flight generate SSE stream, so
  // navigating away or re-triggering generate doesn't leave the previous
  // fetch/read loop running against an unmounted component.
  const cancelStreamRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cancelStreamRef.current?.();
  }, []);

  function generate() {
    if (!applicationId) return;
    cancelStreamRef.current?.();
    setGenerating(true);
    setError('');
    setProgress('Starting...');

    cancelStreamRef.current = apiSSE(
      `/applications/${applicationId}/interview-prep/generate/stream`,
      undefined,
      {
        onProgress: setProgress,
        onDone: () => {
          setGenerating(false);
          queryClient.invalidateQueries({ queryKey: ['application', applicationId] });
        },
        onError: (msg) => {
          setGenerating(false);
          setError(msg);
        },
      },
    );
  }

  return { generating, progress, error, generate };
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiSSE } from '@/lib/api';

interface UseFinalizeApplicationResult {
  finalizing: boolean;
  progress: string;
  error: string;
  finalize: () => void;
}

/**
 * Triggers POST /api/applications/:id/finalize/stream and tracks its SSE
 * progress. Shared by /apply/manual (mid-flow, right after resume review)
 * and /applications/[id] (reviewing an already-drafted application) — both
 * let the user confirm a resume selection and kick off email drafting the
 * same way.
 */
export function useFinalizeApplication(
  applicationId: string | null,
): UseFinalizeApplicationResult {
  const queryClient = useQueryClient();
  const [finalizing, setFinalizing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  // Holds the cancel handle for the in-flight finalize SSE stream, so
  // navigating away or re-triggering finalize doesn't leave the previous
  // fetch/read loop running against an unmounted component.
  const cancelStreamRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cancelStreamRef.current?.();
  }, []);

  function finalize() {
    if (!applicationId) return;
    cancelStreamRef.current?.();
    setFinalizing(true);
    setError('');
    setProgress('Starting...');

    cancelStreamRef.current = apiSSE(`/applications/${applicationId}/finalize/stream`, undefined, {
      onProgress: setProgress,
      onDone: () => {
        setFinalizing(false);
        queryClient.invalidateQueries({ queryKey: ['application', applicationId] });
      },
      onError: (msg) => {
        setFinalizing(false);
        setError(msg);
      },
    });
  }

  return { finalizing, progress, error, finalize };
}

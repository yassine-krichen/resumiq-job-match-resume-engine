'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiSSE } from '@/lib/api';

interface UseRegenerateApplicationResult {
  regenerating: boolean;
  progress: string;
  error: string;
  regenerate: () => void;
}

/**
 * Triggers POST /api/applications/:id/regenerate/stream and tracks its SSE
 * progress — same progress/done/error framing as `useFinalizeApplication`,
 * pointed at the regenerate endpoint instead. Used by /applications/[id] to
 * re-draft an application from scratch at any step.
 */
export function useRegenerateApplication(
  applicationId: string | null,
): UseRegenerateApplicationResult {
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  // Holds the cancel handle for the in-flight regenerate SSE stream, so
  // navigating away or re-triggering regenerate doesn't leave the previous
  // fetch/read loop running against an unmounted component.
  const cancelStreamRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cancelStreamRef.current?.();
  }, []);

  function regenerate() {
    if (!applicationId) return;
    cancelStreamRef.current?.();
    setRegenerating(true);
    setError('');
    setProgress('Starting...');

    cancelStreamRef.current = apiSSE(
      `/applications/${applicationId}/regenerate/stream`,
      undefined,
      {
        onProgress: setProgress,
        onDone: () => {
          setRegenerating(false);
          queryClient.invalidateQueries({ queryKey: ['application', applicationId] });
        },
        onError: (msg) => {
          setRegenerating(false);
          setError(msg);
        },
      },
    );
  }

  return { regenerating, progress, error, regenerate };
}

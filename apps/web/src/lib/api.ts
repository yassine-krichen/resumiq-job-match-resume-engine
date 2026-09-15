export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Default request timeout for plain request/response calls. Long-running
// streaming calls go through `apiSSE` instead and are deliberately exempt.
const DEFAULT_TIMEOUT_MS = 30_000;

// `apiSSE` streams have no fixed duration (the AI pipeline can legitimately
// take a while), so it can't reuse DEFAULT_TIMEOUT_MS as a whole-request
// cap. Instead it resets an idle timer on every received chunk — a
// genuinely hung connection (server died mid-stream, network stall) with no
// bytes at all for this long is treated as a terminal error rather than
// leaving the caller on "Analyzing..." forever.
// The backend sends a heartbeat `progress` event every ~12s while an LLM
// call is in flight (see onboarding.service.ts), so this idle timer should
// rarely come close to firing — 60s leaves a comfortable margin over that.
const SSE_IDLE_TIMEOUT_MS = 60_000;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), DEFAULT_TIMEOUT_MS);

  // If the caller passed their own signal, forward its abort to the timeout
  // controller so both sources can cancel the request. We deliberately avoid
  // `AbortSignal.any` here since it isn't reliably supported across the
  // browser range this app targets (no browserslist floor is pinned).
  const callerSignal = options?.signal;
  const onCallerAbort = () => timeoutController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      timeoutController.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
      signal: timeoutController.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Only a genuine timeout should be reported as such — if the caller's
      // own signal triggered the abort, surface the original AbortError.
      if (!callerSignal?.aborted) {
        throw new Error(`API request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s: ${path}`);
      }
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

export function apiSSE(
  path: string,
  body: unknown,
  options: {
    onProgress: (step: string) => void;
    onDone: (data: unknown) => void;
    onError: (msg: string) => void;
  },
): () => void {
  const controller = new AbortController();
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const resetIdleTimeout = () => {
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SSE_IDLE_TIMEOUT_MS);
  };

  (async () => {
    try {
      resetIdleTimeout();
      const res = await fetch(`${API_URL}/api${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        options.onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdleTimeout();

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const eventMatch = part.match(/^event: (\w+)/m);
          const dataMatch = part.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1];
          const data = JSON.parse(dataMatch[1]) as Record<string, unknown>;

          if (event === 'progress') options.onProgress(data.step as string);
          else if (event === 'done') options.onDone(data);
          else if (event === 'error') options.onError(data.message as string);
        }
      }
    } catch (err) {
      if (timedOut) {
        options.onError(`No response from server for ${SSE_IDLE_TIMEOUT_MS / 1000}s — timed out`);
      } else if ((err as Error).name !== 'AbortError') {
        options.onError((err as Error).message);
      }
    } finally {
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
    }
  })();

  return () => {
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    controller.abort();
  };
}

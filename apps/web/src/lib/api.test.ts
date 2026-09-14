import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch, apiSSE } from './api';

// Builds an `AbortError` matching what a real `fetch` implementation throws
// when its request signal aborts (Node/browser `fetch` both use this name).
function newAbortError(message = 'The operation was aborted.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

// A `fetch` stand-in that never resolves on its own — it only settles when
// the `signal` passed to it aborts, exactly like a real hung request would.
// This lets timeout/abort tests drive the mock purely through AbortSignal
// events instead of racing real timers.
function fetchThatHangsUntilAborted(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(newAbortError()), { once: true });
    });
  });
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves with the parsed JSON body on a successful fetch', async () => {
    const payload = { id: '1', name: 'test' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/profile')).resolves.toEqual(payload);
  });

  it('rejects with an Error (rather than throwing synchronously) on a failed fetch, without leaking to the caller as an unhandled exception', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });
    vi.stubGlobal('fetch', fetchMock);

    let caughtError: Error | null = null;
    let data: unknown = undefined;

    try {
      data = await apiFetch('/profile');
    } catch (err) {
      caughtError = err as Error;
    }

    expect(data).toBeUndefined();
    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError?.message).toContain('404');
  });

  describe('30s request timeout', () => {
    it('rejects with a timeout error once the request hangs past the 30s window', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', fetchThatHangsUntilAborted());

      const rejection = expect(apiFetch('/profile')).rejects.toThrow(
        'API request timed out after 30s: /profile',
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    });

    it('clears the timeout timer once the fetch resolves successfully', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await apiFetch('/profile');

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('propagates a non-abort fetch failure unchanged, without relabeling it as a timeout, and still clears the timer', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const networkError = new Error('network unreachable');
      const fetchMock = vi.fn().mockRejectedValue(networkError);
      vi.stubGlobal('fetch', fetchMock);

      let caughtError: Error | null = null;
      try {
        await apiFetch('/profile');
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBe(networkError);
      expect(caughtError?.message).not.toContain('timed out');
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("surfaces the caller's own AbortError unchanged when the caller's signal aborts mid-request", async () => {
      vi.stubGlobal('fetch', fetchThatHangsUntilAborted());

      const controller = new AbortController();
      const promise = apiFetch('/profile', { signal: controller.signal });
      controller.abort();

      let caughtError: Error | null = null;
      try {
        await promise;
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect(caughtError?.name).toBe('AbortError');
      expect(caughtError?.message).toBe('The operation was aborted.');
    });

    it('does not report a caller-triggered abort as an API timeout', async () => {
      vi.stubGlobal('fetch', fetchThatHangsUntilAborted());

      const controller = new AbortController();
      const promise = apiFetch('/profile', { signal: controller.signal });
      controller.abort();

      // The whole point of distinguishing caller aborts from timeouts: a
      // caller-triggered abort must never surface the "timed out" message,
      // since the caller — not the 30s deadline — is who cancelled it.
      await expect(promise).rejects.not.toThrow(/timed out/);
    });
  });
});

describe('apiSSE', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('45s idle timeout', () => {
    it('aborts the stream and reports a timeout-shaped error when no chunk arrives for 45s', async () => {
      vi.useFakeTimers();
      // Body whose reader never resolves on its own — only settles (with an
      // AbortError) once the request's own signal aborts, exactly like a
      // real stalled connection with zero bytes ever received.
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          body: {
            getReader: () => ({
              read: () =>
                new Promise((_resolve, reject) => {
                  init?.signal?.addEventListener('abort', () => reject(newAbortError()), {
                    once: true,
                  });
                }),
            }),
          },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const onError = vi.fn();

      apiSSE(
        '/onboarding/ingest/stream',
        { raw_text: 'x' },
        { onProgress: vi.fn(), onDone: vi.fn(), onError },
      );

      await vi.advanceTimersByTimeAsync(45_000);

      expect(onError).toHaveBeenCalledWith('No response from server for 45s — timed out');
    });

    it('resets the idle timer on each received chunk, so a stream that keeps sending data past the original 45s deadline never times out', async () => {
      vi.useFakeTimers();

      // A controllable body: `read()` stays pending until `pushChunk` is
      // called, mirroring a real stream that delivers bytes intermittently.
      let signal: AbortSignal | undefined;
      let resolveCurrentRead: ((v: { done: boolean; value?: Uint8Array }) => void) | null = null;
      const pushChunk = (text: string) => {
        const value = new TextEncoder().encode(text);
        resolveCurrentRead?.({ done: false, value });
        resolveCurrentRead = null;
      };
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return Promise.resolve({
          ok: true,
          body: {
            getReader: () => ({
              read: () =>
                new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
                  resolveCurrentRead = resolve;
                  signal?.addEventListener('abort', () => reject(newAbortError()), {
                    once: true,
                  });
                }),
            }),
          },
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      const onProgress = vi.fn();
      const onError = vi.fn();

      const stop = apiSSE(
        '/onboarding/ingest/stream',
        { raw_text: 'x' },
        { onProgress, onDone: vi.fn(), onError },
      );
      // Let the stream reach its first pending reader.read() call.
      await vi.advanceTimersByTimeAsync(0);

      // A chunk arrives just before the original 45s idle deadline would fire.
      await vi.advanceTimersByTimeAsync(40_000);
      pushChunk('event: progress\ndata: {"step":"Parsing..."}\n\n');
      await vi.advanceTimersByTimeAsync(0);

      // 10s later (50s total elapsed) — past the ORIGINAL 45s deadline, but
      // the chunk above reset the idle timer, so no timeout should fire.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onProgress).toHaveBeenCalledWith('Parsing...');
      expect(onError).not.toHaveBeenCalled();

      // Tear down the still-open stream so its pending read() doesn't leak
      // past this test.
      stop();
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});

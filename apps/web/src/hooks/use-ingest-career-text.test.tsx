import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIngestCareerText } from './use-ingest-career-text';
import { apiSSE } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiSSE: vi.fn(),
}));

interface SSEOptions {
  onProgress: (step: string) => void;
  onDone: (data: unknown) => void;
  onError: (msg: string) => void;
}

describe('useIngestCareerText', () => {
  beforeEach(() => {
    vi.mocked(apiSSE).mockReset();
  });

  it('sets loading and an initial progress message, and posts the raw text to the ingest/stream endpoint', () => {
    vi.mocked(apiSSE).mockReturnValue(() => {});
    const { result } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('Worked at Acme as a backend engineer.'));

    expect(result.current.loading).toBe(true);
    expect(result.current.progress).toBe('Starting...');
    expect(apiSSE).toHaveBeenCalledWith(
      '/onboarding/ingest/stream',
      { raw_text: 'Worked at Acme as a backend engineer.' },
      expect.objectContaining({
        onProgress: expect.any(Function),
        onDone: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('updates progress as onProgress events arrive from the SSE stream', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { result } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('some text'));
    act(() => options.onProgress('Parsing experience...'));

    expect(result.current.progress).toBe('Parsing experience...');
  });

  it('clears loading and populates parseSummary from parsed/droppedCount once the stream reports done', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { result } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('some text'));
    act(() => options.onDone({ parsed: [{ id: '1' }, { id: '2' }], droppedCount: 1 }));

    expect(result.current.loading).toBe(false);
    expect(result.current.parseSummary).toEqual({ parsed: 2, dropped: 1 });
  });

  it('defaults parseSummary to zero counts when the done payload omits parsed/droppedCount', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { result } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('some text'));
    act(() => options.onDone({}));

    expect(result.current.parseSummary).toEqual({ parsed: 0, dropped: 0 });
  });

  it('clears loading and surfaces the error message when the stream reports an error, without setting parseSummary', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { result } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('some text'));
    act(() => options.onError('HTTP 500'));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('HTTP 500');
    expect(result.current.parseSummary).toBeNull();
  });

  it('clears a previous error and parseSummary once ingest is triggered again', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { result } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('some text'));
    act(() => options.onDone({ parsed: [{ id: '1' }], droppedCount: 0 }));
    expect(result.current.parseSummary).toEqual({ parsed: 1, dropped: 0 });

    act(() => result.current.ingest('more text'));

    expect(result.current.parseSummary).toBeNull();
    expect(result.current.error).toBe('');
  });

  it('cancels the previous in-flight stream before starting a new one when ingest is called again', () => {
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    vi.mocked(apiSSE).mockReturnValueOnce(cancelFirst).mockReturnValueOnce(cancelSecond);
    const { result } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('first'));
    act(() => result.current.ingest('second'));

    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(cancelSecond).not.toHaveBeenCalled();
    expect(apiSSE).toHaveBeenCalledTimes(2);
  });

  it('cancels the in-flight stream when the component unmounts', () => {
    const cancel = vi.fn();
    vi.mocked(apiSSE).mockReturnValue(cancel);
    const { result, unmount } = renderHook(() => useIngestCareerText());

    act(() => result.current.ingest('some text'));
    unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does nothing on unmount when ingest was never called', () => {
    const { unmount } = renderHook(() => useIngestCareerText());

    expect(() => unmount()).not.toThrow();
    expect(apiSSE).not.toHaveBeenCalled();
  });
});

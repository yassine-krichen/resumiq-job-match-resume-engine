import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGenerateInterviewPrepReport } from './use-generate-interview-prep-report';
import { apiSSE } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiSSE: vi.fn(),
}));

interface SSEOptions {
  onProgress: (step: string) => void;
  onDone: (data: unknown) => void;
  onError: (msg: string) => void;
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidateSpy };
}

describe('useGenerateInterviewPrepReport', () => {
  beforeEach(() => {
    vi.mocked(apiSSE).mockReset();
  });

  it('does not start an SSE stream when applicationId is null', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useGenerateInterviewPrepReport(null), { wrapper: Wrapper });

    act(() => result.current.generate());

    expect(apiSSE).not.toHaveBeenCalled();
    expect(result.current.generating).toBe(false);
  });

  it('sets generating and an initial progress message, and posts to the interview-prep generate/stream endpoint for the given applicationId', () => {
    vi.mocked(apiSSE).mockReturnValue(() => {});
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.generate());

    expect(result.current.generating).toBe(true);
    expect(result.current.progress).toBe('Starting...');
    expect(apiSSE).toHaveBeenCalledWith(
      '/applications/app-1/interview-prep/generate/stream',
      undefined,
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
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.generate());
    act(() => options.onProgress('Synthesizing report...'));

    expect(result.current.progress).toBe('Synthesizing report...');
  });

  it('clears generating and invalidates the application query once the stream reports done', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.generate());
    act(() => options.onDone({ applicationId: 'app-1' }));

    expect(result.current.generating).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['application', 'app-1'] });
  });

  it('clears generating and surfaces the error message when the stream reports an error, without invalidating the query', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.generate());
    act(() => options.onError('HTTP 500'));

    expect(result.current.generating).toBe(false);
    expect(result.current.error).toBe('HTTP 500');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('clears a previous error message once generate is triggered again', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.generate());
    act(() => options.onError('HTTP 500'));
    expect(result.current.error).toBe('HTTP 500');

    act(() => result.current.generate());
    expect(result.current.error).toBe('');
  });

  it('cancels the previous in-flight stream before starting a new one when generate is called again', () => {
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    vi.mocked(apiSSE).mockReturnValueOnce(cancelFirst).mockReturnValueOnce(cancelSecond);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.generate());
    act(() => result.current.generate());

    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(cancelSecond).not.toHaveBeenCalled();
    expect(apiSSE).toHaveBeenCalledTimes(2);
  });

  it('cancels the in-flight stream when the component unmounts', () => {
    const cancel = vi.fn();
    vi.mocked(apiSSE).mockReturnValue(cancel);
    const { Wrapper } = createWrapper();
    const { result, unmount } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.generate());
    unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does nothing on unmount when generate was never called', () => {
    const { Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useGenerateInterviewPrepReport('app-1'), {
      wrapper: Wrapper,
    });

    expect(() => unmount()).not.toThrow();
    expect(apiSSE).not.toHaveBeenCalled();
  });
});

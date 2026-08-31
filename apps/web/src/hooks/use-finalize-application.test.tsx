import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFinalizeApplication } from './use-finalize-application';
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

describe('useFinalizeApplication', () => {
  beforeEach(() => {
    vi.mocked(apiSSE).mockReset();
  });

  it('does not start an SSE stream when applicationId is null', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFinalizeApplication(null), { wrapper: Wrapper });

    act(() => result.current.finalize());

    expect(apiSSE).not.toHaveBeenCalled();
    expect(result.current.finalizing).toBe(false);
  });

  it('sets finalizing and an initial progress message, and posts to the finalize/stream endpoint for the given applicationId', () => {
    vi.mocked(apiSSE).mockReturnValue(() => {});
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFinalizeApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.finalize());

    expect(result.current.finalizing).toBe(true);
    expect(result.current.progress).toBe('Starting...');
    expect(apiSSE).toHaveBeenCalledWith(
      '/applications/app-1/finalize/stream',
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
    const { result } = renderHook(() => useFinalizeApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.finalize());
    act(() => options.onProgress('Drafting email...'));

    expect(result.current.progress).toBe('Drafting email...');
  });

  it('clears finalizing and invalidates the application query once the stream reports done', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useFinalizeApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.finalize());
    act(() => options.onDone({ applicationId: 'app-1' }));

    expect(result.current.finalizing).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['application', 'app-1'] });
  });

  it('clears finalizing and surfaces the error message when the stream reports an error, without invalidating the query', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useFinalizeApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.finalize());
    act(() => options.onError('HTTP 500'));

    expect(result.current.finalizing).toBe(false);
    expect(result.current.error).toBe('HTTP 500');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('clears a previous error message once finalize is triggered again', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFinalizeApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.finalize());
    act(() => options.onError('HTTP 500'));
    expect(result.current.error).toBe('HTTP 500');

    act(() => result.current.finalize());
    expect(result.current.error).toBe('');
  });

  it('cancels the previous in-flight stream before starting a new one when finalize is called again', () => {
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    vi.mocked(apiSSE).mockReturnValueOnce(cancelFirst).mockReturnValueOnce(cancelSecond);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFinalizeApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.finalize());
    act(() => result.current.finalize());

    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(cancelSecond).not.toHaveBeenCalled();
    expect(apiSSE).toHaveBeenCalledTimes(2);
  });

  it('cancels the in-flight stream when the component unmounts', () => {
    const cancel = vi.fn();
    vi.mocked(apiSSE).mockReturnValue(cancel);
    const { Wrapper } = createWrapper();
    const { result, unmount } = renderHook(() => useFinalizeApplication('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.finalize());
    unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does nothing on unmount when finalize was never called', () => {
    const { Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useFinalizeApplication('app-1'), { wrapper: Wrapper });

    expect(() => unmount()).not.toThrow();
    expect(apiSSE).not.toHaveBeenCalled();
  });
});

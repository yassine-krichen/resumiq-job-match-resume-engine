import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRegenerateApplication } from './use-regenerate-application';
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

describe('useRegenerateApplication', () => {
  beforeEach(() => {
    vi.mocked(apiSSE).mockReset();
  });

  it('does not start an SSE stream when applicationId is null', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRegenerateApplication(null), { wrapper: Wrapper });

    act(() => result.current.regenerate());

    expect(apiSSE).not.toHaveBeenCalled();
    expect(result.current.regenerating).toBe(false);
  });

  it('sets regenerating and an initial progress message, and posts to the regenerate/stream endpoint for the given applicationId', () => {
    vi.mocked(apiSSE).mockReturnValue(() => {});
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRegenerateApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.regenerate());

    expect(result.current.regenerating).toBe(true);
    expect(result.current.progress).toBe('Starting...');
    expect(apiSSE).toHaveBeenCalledWith(
      '/applications/app-1/regenerate/stream',
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
    const { result } = renderHook(() => useRegenerateApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.regenerate());
    act(() => options.onProgress('Re-drafting resume...'));

    expect(result.current.progress).toBe('Re-drafting resume...');
  });

  it('clears regenerating and invalidates the application query once the stream reports done', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useRegenerateApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.regenerate());
    act(() => options.onDone({ applicationId: 'app-1' }));

    expect(result.current.regenerating).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['application', 'app-1'] });
  });

  it('clears regenerating and surfaces the error message when the stream reports an error, without invalidating the query', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useRegenerateApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.regenerate());
    act(() => options.onError('HTTP 500'));

    expect(result.current.regenerating).toBe(false);
    expect(result.current.error).toBe('HTTP 500');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('clears a previous error message once regenerate is triggered again', () => {
    let options!: SSEOptions;
    vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
      options = opts as SSEOptions;
      return () => {};
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRegenerateApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.regenerate());
    act(() => options.onError('HTTP 500'));
    expect(result.current.error).toBe('HTTP 500');

    act(() => result.current.regenerate());
    expect(result.current.error).toBe('');
  });

  it('cancels the previous in-flight stream before starting a new one when regenerate is called again', () => {
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    vi.mocked(apiSSE).mockReturnValueOnce(cancelFirst).mockReturnValueOnce(cancelSecond);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRegenerateApplication('app-1'), { wrapper: Wrapper });

    act(() => result.current.regenerate());
    act(() => result.current.regenerate());

    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(cancelSecond).not.toHaveBeenCalled();
    expect(apiSSE).toHaveBeenCalledTimes(2);
  });

  it('cancels the in-flight stream when the component unmounts', () => {
    const cancel = vi.fn();
    vi.mocked(apiSSE).mockReturnValue(cancel);
    const { Wrapper } = createWrapper();
    const { result, unmount } = renderHook(() => useRegenerateApplication('app-1'), {
      wrapper: Wrapper,
    });

    act(() => result.current.regenerate());
    unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does nothing on unmount when regenerate was never called', () => {
    const { Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useRegenerateApplication('app-1'), { wrapper: Wrapper });

    expect(() => unmount()).not.toThrow();
    expect(apiSSE).not.toHaveBeenCalled();
  });
});

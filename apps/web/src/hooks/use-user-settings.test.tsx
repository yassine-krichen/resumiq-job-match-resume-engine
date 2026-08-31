import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdateUserSettings,
  useUserSettings,
  USER_SETTINGS_QUERY_KEY,
} from './use-user-settings';
import { apiFetch } from '@/lib/api';
import type { UserSettings } from './use-user-settings';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    match_threshold: 50,
    preferred_locations: [],
    target_roles: [],
    resume_template: 'default',
    auto_send_email: false,
    notify_on_new_jobs: true,
    category_tags: [],
    work_mode: [],
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe('useUserSettings', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('fetches GET /jobs/settings and returns the parsed settings', async () => {
    vi.mocked(apiFetch).mockResolvedValue(buildSettings({ match_threshold: 65 }));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useUserSettings(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith('/jobs/settings');
    expect(result.current.data?.match_threshold).toBe(65);
  });

  it('surfaces an error when GET /jobs/settings fails', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('API 500: settings unavailable'));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useUserSettings(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('API 500: settings unavailable');
  });
});

describe('useUpdateUserSettings', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('sends a PATCH /jobs/settings request with the given patch', async () => {
    vi.mocked(apiFetch).mockResolvedValue(buildSettings({ match_threshold: 80 }));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useUpdateUserSettings(), { wrapper: Wrapper });
    act(() => {
      result.current.mutate({ match_threshold: 80 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith('/jobs/settings', {
      method: 'PATCH',
      body: JSON.stringify({ match_threshold: 80 }),
    });
  });

  it('surfaces an error when PATCH /jobs/settings fails, without touching the settings cache', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('API 400: invalid threshold'));
    const { Wrapper, queryClient } = createWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useUpdateUserSettings(), { wrapper: Wrapper });
    act(() => {
      result.current.mutate({ match_threshold: -5 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('API 400: invalid threshold');
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });

  it("writes the mutation response directly into the shared 'jobs-settings' cache slot on success, so a sibling useUserSettings reader sees it without an extra GET", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    vi.mocked(apiFetch).mockResolvedValueOnce(buildSettings({ match_threshold: 50 }));
    const { result } = renderHook(
      () => ({ settings: useUserSettings(), update: useUpdateUserSettings() }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledTimes(1);

    vi.mocked(apiFetch).mockResolvedValueOnce(buildSettings({ match_threshold: 90 }));
    act(() => {
      result.current.update.mutate({ match_threshold: 90 });
    });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    // Exactly one GET + one PATCH — no refetch triggered by the cache write.
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(result.current.settings.data?.match_threshold).toBe(90);
    expect(queryClient.getQueryData(USER_SETTINGS_QUERY_KEY)).toEqual(
      buildSettings({ match_threshold: 90 }),
    );
  });
});

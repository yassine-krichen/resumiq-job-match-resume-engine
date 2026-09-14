import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProfileSection } from './use-profile-section';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

function buildProfile(overrides: Partial<MasterDB> = {}): MasterDB {
  return {
    personal_info: {
      name: 'Jane Doe',
      location: '',
      phone: '',
      email: 'jane@example.com',
      work_authorization: [],
      clearances: [],
      links: [],
    },
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: {
      programming_languages: [],
      frameworks_and_libraries: [],
      infrastructure_and_tools: [],
      databases: [],
      spoken_languages: [],
      soft_skills: [],
    },
    certifications: [
      { name: 'AWS SAA', issuer: 'AWS', date: '2022', expiration_date: '', credential_id: '', link: '', description: '' },
      { name: 'CKA', issuer: 'CNCF', date: '2023', expiration_date: '', credential_id: '', link: '', description: '' },
    ],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
    ...overrides,
  };
}

describe('useProfileSection', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('appends the new entry to the end of the section array and PATCHes the full resulting array', async () => {
    const profile = buildProfile();
    const onUpdated = vi.fn();
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());
    const { result } = renderHook(() => useProfileSection(profile, onUpdated, 'certifications'));

    const newCert = { name: 'CKS', issuer: 'CNCF', date: '2024', expiration_date: '', credential_id: '', link: '', description: '' };
    await act(async () => {
      await result.current.addEntry(newCert);
    });

    expect(apiFetch).toHaveBeenCalledWith('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        certifications: [...profile.certifications, newCert],
      }),
    });
    expect(onUpdated).toHaveBeenCalledWith(buildProfile());
  });

  it('replaces only the entry at the given index and leaves the others untouched', async () => {
    const profile = buildProfile();
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());
    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    const updatedCert = { ...profile.certifications[1], name: 'CKA (renewed)' };
    await act(async () => {
      await result.current.updateEntry(1, updatedCert);
    });

    expect(apiFetch).toHaveBeenCalledWith('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        certifications: [profile.certifications[0], updatedCert],
      }),
    });
  });

  it('removes only the entry at the given index, shifting the rest down', async () => {
    const profile = buildProfile();
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());
    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    await act(async () => {
      await result.current.removeEntry(0);
    });

    expect(apiFetch).toHaveBeenCalledWith('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        certifications: [profile.certifications[1]],
      }),
    });
  });

  it('toggles saving to true for the duration of the PATCH and back to false once it resolves', async () => {
    let resolvePatch!: (value: MasterDB) => void;
    vi.mocked(apiFetch).mockReturnValue(
      new Promise((resolve) => {
        resolvePatch = resolve;
      }),
    );
    const profile = buildProfile();
    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    expect(result.current.saving).toBe(false);

    let addPromise!: Promise<void>;
    act(() => {
      addPromise = result.current.addEntry(profile.certifications[0]);
    });

    await waitFor(() => expect(result.current.saving).toBe(true));

    await act(async () => {
      resolvePatch(buildProfile());
      await addPromise;
    });

    expect(result.current.saving).toBe(false);
  });

  it('sets the error message and re-throws when the PATCH fails, so the calling modal can keep itself open', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('API 500: could not save certification'));
    const profile = buildProfile();
    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    await act(async () => {
      await expect(result.current.addEntry(profile.certifications[0])).rejects.toThrow(
        'API 500: could not save certification',
      );
    });

    expect(result.current.error).toBe('API 500: could not save certification');
    expect(result.current.saving).toBe(false);
  });

  it('clears a previous error at the start of the next save attempt', async () => {
    const profile = buildProfile();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('API 500: first failure'));
    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    await act(async () => {
      await expect(result.current.addEntry(profile.certifications[0])).rejects.toThrow();
    });
    expect(result.current.error).toBe('API 500: first failure');

    vi.mocked(apiFetch).mockResolvedValueOnce(buildProfile());
    await act(async () => {
      await result.current.addEntry(profile.certifications[0]);
    });

    expect(result.current.error).toBe('');
  });

  it('is a no-op that does not call apiFetch when profile has not loaded yet', async () => {
    const { result } = renderHook(() => useProfileSection(null, vi.fn(), 'certifications'));

    await act(async () => {
      await result.current.addEntry({
        name: 'X',
        issuer: 'Y',
        date: '',
        expiration_date: '',
        credential_id: '',
        link: '',
        description: '',
      });
    });

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('does not deduplicate or block a second save call fired while the first is still in flight — both requests go out (single-flight is not enforced by this hook)', async () => {
    const profile = buildProfile();
    let resolveFirst!: (value: MasterDB) => void;
    const firstPromise = new Promise<MasterDB>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(apiFetch).mockReturnValueOnce(firstPromise);
    vi.mocked(apiFetch).mockResolvedValueOnce(buildProfile());

    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    let firstAdd!: Promise<void>;
    let secondAdd!: Promise<void>;
    act(() => {
      firstAdd = result.current.addEntry(profile.certifications[0]);
      secondAdd = result.current.addEntry(profile.certifications[1]);
    });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirst(buildProfile());
      await Promise.all([firstAdd, secondAdd]);
    });

    // Both calls fired independently against the same `currentEntries()`
    // snapshot taken at call time — the hook has no request queue/lock, so
    // overlapping saves race rather than serialize.
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});

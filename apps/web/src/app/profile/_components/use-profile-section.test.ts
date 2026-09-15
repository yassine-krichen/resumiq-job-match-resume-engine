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

  it('sends a single add-entry operation to PATCH /profile/entries', async () => {
    const profile = buildProfile();
    const onUpdated = vi.fn();
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());
    const { result } = renderHook(() => useProfileSection(profile, onUpdated, 'certifications'));

    const newCert = { name: 'CKS', issuer: 'CNCF', date: '2024', expiration_date: '', credential_id: '', link: '', description: '' };
    await act(async () => {
      await result.current.addEntry(newCert);
    });

    expect(apiFetch).toHaveBeenCalledWith('/profile/entries', {
      method: 'PATCH',
      body: JSON.stringify({
        section: 'certifications',
        operation: 'add',
        entry: newCert,
      }),
    });
    expect(onUpdated).toHaveBeenCalledWith(buildProfile());
  });

  it('sends a single update-entry operation with the target index to PATCH /profile/entries', async () => {
    const profile = buildProfile();
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());
    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    const updatedCert = { ...profile.certifications[1], name: 'CKA (renewed)' };
    await act(async () => {
      await result.current.updateEntry(1, updatedCert);
    });

    expect(apiFetch).toHaveBeenCalledWith('/profile/entries', {
      method: 'PATCH',
      body: JSON.stringify({
        section: 'certifications',
        operation: 'update',
        index: 1,
        entry: updatedCert,
        expectedEntry: profile.certifications[1],
      }),
    });
  });

  it('sends a single remove-entry operation with the target index to PATCH /profile/entries', async () => {
    const profile = buildProfile();
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());
    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    await act(async () => {
      await result.current.removeEntry(0);
    });

    expect(apiFetch).toHaveBeenCalledWith('/profile/entries', {
      method: 'PATCH',
      body: JSON.stringify({
        section: 'certifications',
        operation: 'remove',
        index: 0,
        expectedEntry: profile.certifications[0],
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

  it('fires two overlapping add-entry calls as two independent single-entry operations, neither depending on a snapshot of the other', async () => {
    // Each `addEntry` call sends only its own `{ operation: 'add', entry }`
    // — never a client-computed full array — so it carries no stale
    // knowledge of the section's current contents. The server merges each
    // operation against a transaction-fresh read (see
    // `ProfileService#mutateSectionEntry`), so unlike the old client-array
    // PATCH, whichever request's lock is acquired second still lands on top
    // of the first request's write instead of clobbering it. This test
    // exercises the hook's side (both calls fire and both resolve); the
    // server-side no-lost-update guarantee is covered by
    // `profile.service.spec.ts`.
    const profile = buildProfile();
    let resolveFirst!: (value: MasterDB) => void;
    const firstPromise = new Promise<MasterDB>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(apiFetch).mockReturnValueOnce(firstPromise);
    vi.mocked(apiFetch).mockResolvedValueOnce(buildProfile());

    const { result } = renderHook(() => useProfileSection(profile, vi.fn(), 'certifications'));

    const firstEntry = profile.certifications[0];
    const secondEntry = profile.certifications[1];
    let firstAdd!: Promise<void>;
    let secondAdd!: Promise<void>;
    act(() => {
      firstAdd = result.current.addEntry(firstEntry);
      secondAdd = result.current.addEntry(secondEntry);
    });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirst(buildProfile());
      await Promise.all([firstAdd, secondAdd]);
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/profile/entries', {
      method: 'PATCH',
      body: JSON.stringify({ section: 'certifications', operation: 'add', entry: firstEntry }),
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/profile/entries', {
      method: 'PATCH',
      body: JSON.stringify({ section: 'certifications', operation: 'add', entry: secondEntry }),
    });
  });
});

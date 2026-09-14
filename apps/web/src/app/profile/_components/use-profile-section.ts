'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';

/** Keys of `MasterDB` whose value is an array — the only sections this hook
 * (and its add/edit/delete UI) can operate on. */
type ArraySectionKey = {
  [K in keyof MasterDB]: MasterDB[K] extends unknown[] ? K : never;
}[keyof MasterDB];

export interface UseProfileSectionResult<T> {
  saving: boolean;
  error: string;
  /** Appends a new entry to the end of the section array. */
  addEntry: (entry: T) => Promise<void>;
  /** Replaces the entry at `index` with `entry`. */
  updateEntry: (index: number, entry: T) => Promise<void>;
  /** Removes the entry at `index`. */
  removeEntry: (index: number) => Promise<void>;
}

/**
 * Shared add/edit/delete logic for any array-shaped `MasterDB` profile
 * section (experience, projects, education, certifications, awards, ...).
 *
 * `PATCH /profile` replaces a section's array wholesale — `ProfileService
 * .upsertProfile` merges the request body over the existing profile with a
 * shallow `{ ...base, ...patch }` (see `mergeMasterDB`), so a partial-index
 * update isn't possible server-side. Every mutation here therefore builds
 * the *entire* next array client-side and sends that.
 */
export function useProfileSection<K extends ArraySectionKey>(
  profile: MasterDB | null,
  onUpdated: (profile: MasterDB) => void,
  section: K,
): UseProfileSectionResult<MasterDB[K][number]> {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(nextArray: MasterDB[K]): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<MasterDB>('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ [section]: nextArray }),
      });
      onUpdated(updated);
    } catch (err) {
      setError((err as Error).message);
      // Re-thrown so the calling modal knows the save failed and can keep
      // itself open with the entered data intact instead of clearing it.
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function currentEntries(): Array<MasterDB[K][number]> {
    return ((profile?.[section] as Array<MasterDB[K][number]> | undefined) ?? []);
  }

  async function addEntry(entry: MasterDB[K][number]): Promise<void> {
    if (!profile) return;
    await save([...currentEntries(), entry] as MasterDB[K]);
  }

  async function updateEntry(index: number, entry: MasterDB[K][number]): Promise<void> {
    if (!profile) return;
    const next = currentEntries().map((item, i) => (i === index ? entry : item));
    await save(next as MasterDB[K]);
  }

  async function removeEntry(index: number): Promise<void> {
    if (!profile) return;
    const next = currentEntries().filter((_, i) => i !== index);
    await save(next as MasterDB[K]);
  }

  return { saving, error, addEntry, updateEntry, removeEntry };
}

'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { MasterDB, ProfileArraySection } from '@resumiq/schemas';

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
 * Each mutation is sent to `PATCH /profile/entries` as a single add/update/
 * remove operation — the server applies it against a transaction-fresh read
 * (see `ProfileService#mutateSectionEntry`), so overlapping saves (two tabs,
 * a slow request retried, a remount) can no longer silently drop each
 * other's entry the way building the entire next array client-side from a
 * possibly-stale `profile` prop snapshot could.
 */
export function useProfileSection<K extends ArraySectionKey>(
  profile: MasterDB | null,
  onUpdated: (profile: MasterDB) => void,
  section: K,
): UseProfileSectionResult<MasterDB[K][number]> {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function mutate(
    operation:
      | { operation: 'add'; entry: MasterDB[K][number] }
      | {
          operation: 'update';
          index: number;
          entry: MasterDB[K][number];
          expectedEntry: MasterDB[K][number];
        }
      | { operation: 'remove'; index: number; expectedEntry: MasterDB[K][number] },
  ): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<MasterDB>('/profile/entries', {
        method: 'PATCH',
        body: JSON.stringify({ section: section as ProfileArraySection, ...operation }),
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

  async function addEntry(entry: MasterDB[K][number]): Promise<void> {
    if (!profile) return;
    await mutate({ operation: 'add', entry });
  }

  async function updateEntry(index: number, entry: MasterDB[K][number]): Promise<void> {
    if (!profile) return;
    // `expectedEntry` is the entry as this client last saw it — the server
    // compares it against a transaction-fresh read at `index` and rejects
    // the mutation if they differ, so a stale index (e.g. from a concurrent
    // remove shifting indices) can't silently land on the wrong entry.
    await mutate({ operation: 'update', index, entry, expectedEntry: profile[section][index] });
  }

  async function removeEntry(index: number): Promise<void> {
    if (!profile) return;
    await mutate({ operation: 'remove', index, expectedEntry: profile[section][index] });
  }

  return { saving, error, addEntry, updateEntry, removeEntry };
}

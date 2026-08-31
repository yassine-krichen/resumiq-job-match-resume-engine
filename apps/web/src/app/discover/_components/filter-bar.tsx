'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateUserSettings } from '@/hooks/use-user-settings';
import type { DiscoverFilters } from './types';

const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;

interface FilterBarProps {
  filters: DiscoverFilters;
  onChange: (filters: DiscoverFilters) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps): React.JSX.Element {
  const [categoryTags, setCategoryTags] = useState((filters.category_tags ?? []).join(', '));
  const [workMode, setWorkMode] = useState<string[]>(filters.work_mode ?? []);
  const [location, setLocation] = useState(filters.location ?? '');
  const [seniority, setSeniority] = useState(filters.seniority ?? '');

  // Re-seeds the bar whenever the parent's category_tags/work_mode content
  // actually changes (e.g. once the persisted settings load) — after that,
  // "Apply filters" is the only thing that pushes changes back out. Adjusted
  // during render rather than in an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const filterSeedKey = `${(filters.category_tags ?? []).join(',')}|${(filters.work_mode ?? []).join(',')}`;
  const [seededKey, setSeededKey] = useState(filterSeedKey);
  if (seededKey !== filterSeedKey) {
    setSeededKey(filterSeedKey);
    setCategoryTags((filters.category_tags ?? []).join(', '));
    setWorkMode(filters.work_mode ?? []);
  }

  const settingsMutation = useUpdateUserSettings();

  function toggleWorkMode(mode: string) {
    setWorkMode((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
  }

  function handleApply() {
    const nextCategoryTags = categoryTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    onChange({
      category_tags: nextCategoryTags,
      work_mode: workMode,
      location: location.trim() || undefined,
      seniority: seniority.trim() || undefined,
    });

    // Only category_tags/work_mode are part of the persisted UserSettings —
    // location/seniority stay session-only filter params.
    settingsMutation.mutate({ category_tags: nextCategoryTags, work_mode: workMode });
  }

  return (
    <div className="w-full max-w-3xl rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="filter-category">Category / field</Label>
          <Input
            id="filter-category"
            value={categoryTags}
            onChange={(e) => setCategoryTags(e.target.value)}
            placeholder="e.g. backend, data"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="filter-location">Location</Label>
          <Input
            id="filter-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Remote, Berlin"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-zinc-400">Resets each visit — not saved.</p>
        </div>
        <div>
          <Label htmlFor="filter-seniority">Seniority</Label>
          <Input
            id="filter-seniority"
            value={seniority}
            onChange={(e) => setSeniority(e.target.value)}
            placeholder="e.g. Senior"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-zinc-400">Resets each visit — not saved.</p>
        </div>
        <div>
          <Label>Work mode</Label>
          <div className="mt-1 flex flex-wrap gap-3 pt-1.5">
            {WORK_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-1.5 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={workMode.includes(mode)}
                  onChange={() => toggleWorkMode(mode)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                {mode}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {settingsMutation.isError && (
          <p className="text-sm text-red-600">Couldn&apos;t save filter preferences.</p>
        )}
        <Button type="button" onClick={handleApply} disabled={settingsMutation.isPending}>
          Apply filters
        </Button>
      </div>
    </div>
  );
}

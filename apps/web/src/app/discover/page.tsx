'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUserSettings } from '@/hooks/use-user-settings';
import {
  dismissJob,
  getDiscoverFeed,
  refreshMatchPreviews,
  swipeRightJob,
} from './_components/api';
import { FilterBar } from './_components/filter-bar';
import { SwipeDeck } from './_components/swipe-deck';
import type { DiscoverFeedResult, DiscoverFilters } from './_components/types';

const DISCOVER_FEED_PAGE = 1;

export default function DiscoverPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<DiscoverFilters>({});
  const [swipeMessage, setSwipeMessage] = useState('');

  const settingsQuery = useUserSettings();

  // Seeds the filter bar from the persisted category_tags/work_mode settings
  // once, on first load — after that the filter bar itself is the source of
  // truth (see FilterBar's "Apply filters"). Adjusted during render rather
  // than in an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [settingsSeeded, setSettingsSeeded] = useState(false);
  const settings = settingsQuery.data;
  if (!settingsSeeded && settings) {
    setSettingsSeeded(true);
    setFilters((prev) => ({
      ...prev,
      category_tags: prev.category_tags ?? settings.category_tags,
      work_mode: prev.work_mode ?? settings.work_mode,
    }));
  }

  // Login-trigger substitute — there's no existing auth hook to attach a
  // "just signed in" refresh to, so the /discover mount does it instead,
  // once, before the feed below is fetched.
  useEffect(() => {
    refreshMatchPreviews().catch(() => {
      // Best-effort: a stale match preview just means slightly outdated
      // scores, never a blocking error for the page.
    });
  }, []);

  const feedQueryKey = ['discover-feed', filters] as const;
  const feedQuery = useQuery({
    queryKey: feedQueryKey,
    queryFn: () => getDiscoverFeed(filters, DISCOVER_FEED_PAGE),
  });

  // Shared optimistic-removal logic: the card is already animated off-screen
  // by SwipeDeck by the time either mutation fires, so the cache should
  // reflect that immediately rather than waiting on the round-trip — with a
  // rollback if the request turns out to have failed.
  async function optimisticallyRemove(jobId: string) {
    // Captured at removal time (not re-derived from render state in
    // onError) so a filter change between mutate() and its rollback can't
    // write the old view's snapshot into the new view's cache slot.
    const queryKey = feedQueryKey;
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<DiscoverFeedResult>(queryKey);
    queryClient.setQueryData<DiscoverFeedResult>(queryKey, (old) =>
      old ? { ...old, items: old.items.filter((item) => item.job.id !== jobId) } : old,
    );
    return { previous, queryKey };
  }

  function rollback(
    context: { previous?: DiscoverFeedResult; queryKey: typeof feedQueryKey } | undefined,
  ) {
    if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
  }

  const dismissMutation = useMutation({
    mutationFn: dismissJob,
    onMutate: optimisticallyRemove,
    onError: (_err, _jobId, context) => rollback(context),
  });

  const swipeRightMutation = useMutation({
    mutationFn: swipeRightJob,
    onMutate: async (jobId: string) => {
      const item = feedQuery.data?.items.find((i) => i.job.id === jobId);
      const context = await optimisticallyRemove(jobId);
      setSwipeMessage(
        item
          ? `Drafting your resume for ${item.job.companyName} in the background — check your Applications list to review it.`
          : "Drafting your resume in the background — check your Applications list to review it.",
      );
      return context;
    },
    onError: (_err, _jobId, context) => {
      rollback(context);
      setSwipeMessage('');
    },
  });

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Discover jobs</h1>
        <p className="mt-1 text-zinc-500">
          Swipe right to draft a resume in the background — swipe left to pass.
        </p>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {swipeMessage && (
        <div className="w-full max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {swipeMessage}
        </div>
      )}

      {feedQuery.isLoading && <p className="text-zinc-500">Loading jobs...</p>}
      {feedQuery.isError && <p className="text-red-600">{(feedQuery.error as Error).message}</p>}

      {feedQuery.data && (
        <SwipeDeck
          items={feedQuery.data.items}
          onDismiss={(jobId) => dismissMutation.mutate(jobId)}
          onSwipeRight={(jobId) => swipeRightMutation.mutate(jobId)}
        />
      )}

      {dismissMutation.isError && (
        <p className="text-sm text-red-600">Couldn&apos;t dismiss that job — try again.</p>
      )}
      {swipeRightMutation.isError && (
        <p className="text-sm text-red-600">Couldn&apos;t queue that application — try again.</p>
      )}
    </div>
  );
}

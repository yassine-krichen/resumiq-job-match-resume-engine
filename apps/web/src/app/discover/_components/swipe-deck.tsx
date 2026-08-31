'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { JobCard } from './job-card';
import type { DiscoverFeedItem } from './types';

// How long the exit transform/opacity transition runs before the parent's
// removal callback actually fires — keeps the animation visible instead of
// the card just vanishing.
const EXIT_ANIMATION_MS = 200;

type ExitDirection = 'left' | 'right' | null;

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  if (EDITABLE_TAGS.has(element.tagName)) return true;
  return (element as HTMLElement).isContentEditable === true;
}

interface SwipeDeckProps {
  items: DiscoverFeedItem[];
  onDismiss: (jobId: string) => void;
  onSwipeRight: (jobId: string) => void;
}

export function SwipeDeck({ items, onDismiss, onSwipeRight }: SwipeDeckProps): React.JSX.Element {
  const top = items[0] ?? null;
  const next = items[1] ?? null;
  const [exitDirection, setExitDirection] = useState<ExitDirection>(null);

  // A newly-arrived top card (a different job id) always starts fully
  // visible, even if the previous card was mid-exit-animation when it left.
  // Adjusted during render rather than in an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [renderedTopId, setRenderedTopId] = useState(top?.job.id);
  if (top?.job.id !== renderedTopId) {
    setRenderedTopId(top?.job.id);
    setExitDirection(null);
  }

  const triggerExit = useCallback(
    (direction: 'left' | 'right') => {
      if (!top || exitDirection) return;
      setExitDirection(direction);
      setTimeout(() => {
        if (direction === 'left') onDismiss(top.job.id);
        else onSwipeRight(top.job.id);
      }, EXIT_ANIMATION_MS);
    },
    [top, exitDirection, onDismiss, onSwipeRight],
  );

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      // FilterBar renders text inputs on the same page — arrow keys used to
      // move the cursor while editing them must not also swipe the deck.
      if (isEditableElement(document.activeElement)) return;
      if (e.key === 'ArrowLeft') triggerExit('left');
      else if (e.key === 'ArrowRight') triggerExit('right');
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [triggerExit]);

  if (!top) {
    return (
      <div className="w-full max-w-xl rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
        <p className="font-medium text-zinc-700">No jobs to review right now.</p>
        <p className="mt-1 text-sm">
          Try widening your filters, or check back after the next scan finds new roles.
        </p>
      </div>
    );
  }

  const exitTransform =
    exitDirection === 'left'
      ? '-translate-x-[120%] -rotate-6 opacity-0'
      : exitDirection === 'right'
        ? 'translate-x-[120%] rotate-6 opacity-0'
        : 'translate-x-0 rotate-0 opacity-100';

  return (
    <div className="w-full max-w-xl">
      <div className="relative min-h-[420px]">
        {next && (
          <div className="absolute inset-x-0 top-0 scale-95 translate-y-3 opacity-60" aria-hidden>
            <JobCard item={next} />
          </div>
        )}
        <div
          className={`absolute inset-x-0 top-0 transition-all duration-200 ease-in ${exitTransform}`}
        >
          <JobCard item={top} />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => triggerExit('left')}
          disabled={Boolean(exitDirection)}
        >
          Skip
        </Button>
        <Button type="button" onClick={() => triggerExit('right')} disabled={Boolean(exitDirection)}>
          Apply
        </Button>
      </div>
      <p className="mt-2 text-center text-xs text-zinc-400">Use ← to skip, → to apply</p>
    </div>
  );
}

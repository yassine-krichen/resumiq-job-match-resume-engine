'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { JobCard } from './job-card';
import type { DiscoverFeedItem } from './types';

// How long the exit transform/opacity transition runs before the parent's
// removal callback actually fires — keeps the animation visible instead of
// the card just vanishing.
const EXIT_ANIMATION_MS = 200;

// Horizontal drag distance (px) past which a release counts as a swipe
// instead of snapping back. ~1/3 of the card's max-w-xl (576px) width —
// far enough to filter out accidental taps/clicks, close enough that a
// deliberate Tinder-style flick doesn't feel unresponsive.
const DRAG_THRESHOLD_PX = 120;

// Degrees of rotation per pixel dragged — a subtle tilt so the card feels
// picked up, without the rotation dominating the gesture.
const DRAG_ROTATION_FACTOR = 0.05;

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
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef<number | null>(null);
  // Guards against a second pointer (e.g. a second touch point on a
  // multi-touch device) hijacking an in-progress drag: only move/up/cancel
  // events from the pointer that started the drag are allowed to affect it.
  const activePointerIdRef = useRef<number | null>(null);

  // A newly-arrived top card (a different job id) always starts fully
  // visible, even if the previous card was mid-exit-animation when it left.
  // Adjusted during render rather than in an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [renderedTopId, setRenderedTopId] = useState(top?.job.id);
  if (top?.job.id !== renderedTopId) {
    setRenderedTopId(top?.job.id);
    setExitDirection(null);
    setDragX(0);
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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore additional pointers while one is already driving a drag —
      // e.g. a second touch landing on the card mid-gesture.
      if (exitDirection || activePointerIdRef.current !== null) return;
      activePointerIdRef.current = e.pointerId;
      dragStartXRef.current = e.clientX;
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [exitDirection],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null || e.pointerId !== activePointerIdRef.current) return;
    setDragX(e.clientX - dragStartXRef.current);
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragStartXRef.current === null || e.pointerId !== activePointerIdRef.current) return;
      activePointerIdRef.current = null;
      dragStartXRef.current = null;
      setIsDragging(false);
      if (Math.abs(dragX) > DRAG_THRESHOLD_PX) {
        triggerExit(dragX > 0 ? 'right' : 'left');
      }
      setDragX(0);
    },
    [dragX, triggerExit],
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
      <div className="w-full max-w-xl rounded-xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
        <p className="font-medium text-foreground">No jobs to review right now.</p>
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

  // While actively dragging, the card follows the pointer 1:1 with no CSS
  // transition (via inline style, overriding the class-driven transform
  // below). On release, the inline style is removed and the class-driven
  // transform/transition takes over — animating either the swipe-away exit
  // or the snap-back to center.
  const dragStyle: React.CSSProperties | undefined = isDragging
    ? {
        transform: `translateX(${dragX}px) rotate(${dragX * DRAG_ROTATION_FACTOR}deg)`,
        transition: 'none',
      }
    : undefined;

  return (
    <div className="w-full max-w-xl">
      <div className="relative min-h-[420px]">
        {next && (
          <div className="absolute inset-x-0 top-0 scale-95 translate-y-3 opacity-60" aria-hidden>
            <JobCard item={next} />
          </div>
        )}
        <div
          className={`absolute inset-x-0 top-0 cursor-grab touch-pan-y transition-all duration-200 ease-in active:cursor-grabbing ${exitTransform}`}
          style={dragStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
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
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Drag the card, or use ← to skip, → to apply
      </p>
    </div>
  );
}

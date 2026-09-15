import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SwipeDeck } from './swipe-deck';
import { buildDiscoverJob, buildFeedItem } from './test-fixtures';

const jobOne = buildFeedItem({ job: buildDiscoverJob({ id: 'job-1', title: 'Job One' }) });
const jobTwo = buildFeedItem({ job: buildDiscoverJob({ id: 'job-2', title: 'Job Two' }) });

function renderDeck(items = [jobOne]) {
  const onDismiss = vi.fn();
  const onSwipeRight = vi.fn();
  const utils = render(
    <SwipeDeck items={items} onDismiss={onDismiss} onSwipeRight={onSwipeRight} />,
  );
  return { onDismiss, onSwipeRight, ...utils };
}

// The draggable top card has no accessible role/label of its own (it's a
// plain div wrapping JobCard) — `.cursor-grab` is the one class that
// identifies it as the drag surface, so it's the most stable selector
// available without changing the component.
function getDragHandle(container: HTMLElement): HTMLElement {
  const handle = container.querySelector('.cursor-grab');
  if (!handle) throw new Error('Draggable top card not found');
  return handle as HTMLElement;
}

// DRAG_THRESHOLD_PX in swipe-deck.tsx is 120 and not exported; 200/-200
// comfortably clear it, 50 comfortably stays under it.
function dragCard(handle: HTMLElement, deltaX: number, pointerId = 1) {
  fireEvent.pointerDown(handle, { pointerId, clientX: 0 });
  fireEvent.pointerMove(handle, { pointerId, clientX: deltaX });
  fireEvent.pointerUp(handle, { pointerId, clientX: deltaX });
}

describe('SwipeDeck', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the empty-state message when there are no items to review', () => {
    renderDeck([]);
    expect(screen.getByText('No jobs to review right now.')).toBeInTheDocument();
  });

  it('renders the top item as the visible card', () => {
    renderDeck([jobOne, jobTwo]);
    expect(screen.getByRole('heading', { name: 'Job One' })).toBeInTheDocument();
  });

  it('renders the second item as a peeking preview card behind the top card', () => {
    renderDeck([jobOne, jobTwo]);
    expect(screen.getByText('Job Two')).toBeInTheDocument();
  });

  it('does not call onDismiss immediately when "Skip" is clicked — waits for the exit animation', () => {
    vi.useFakeTimers();
    const { onDismiss } = renderDeck([jobOne]);

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(199));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('job-1');
  });

  it('does not call onSwipeRight immediately when "Apply" is clicked — waits for the exit animation', () => {
    vi.useFakeTimers();
    const { onSwipeRight } = renderDeck([jobOne]);

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onSwipeRight).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(200));
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).toHaveBeenCalledWith('job-1');
  });

  it('dismisses the top job when ArrowLeft is pressed, after the exit animation elapses', () => {
    vi.useFakeTimers();
    const { onDismiss } = renderDeck([jobOne]);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).toHaveBeenCalledWith('job-1');
  });

  it('swipes right on the top job when ArrowRight is pressed, after the exit animation elapses', () => {
    vi.useFakeTimers();
    const { onSwipeRight } = renderDeck([jobOne]);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(200));

    expect(onSwipeRight).toHaveBeenCalledWith('job-1');
  });

  it('ignores keys other than ArrowLeft/ArrowRight', () => {
    vi.useFakeTimers();
    const { onDismiss, onSwipeRight } = renderDeck([jobOne]);

    fireEvent.keyDown(window, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('disables the Skip and Apply buttons while an exit animation is in progress', () => {
    vi.useFakeTimers();
    renderDeck([jobOne]);

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));

    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  });

  it('ignores a second ArrowLeft press while the first exit animation is still in progress, calling onDismiss only once', () => {
    vi.useFakeTimers();
    const { onDismiss } = renderDeck([jobOne]);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores an ArrowRight press once an ArrowLeft exit is already in progress, calling only onDismiss', () => {
    vi.useFakeTimers();
    const { onDismiss, onSwipeRight } = renderDeck([jobOne]);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('does not trigger a swipe when an arrow key is pressed while a text input is focused', () => {
    vi.useFakeTimers();
    const { onDismiss, onSwipeRight } = renderDeck([jobOne]);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();

    input.remove();
  });

  it('still triggers a swipe on arrow keys when focus is elsewhere on the page', () => {
    vi.useFakeTimers();
    const { onDismiss } = renderDeck([jobOne]);

    (document.body as HTMLElement).focus();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).toHaveBeenCalledWith('job-1');
  });

  it('re-enables the deck immediately once a different job becomes the top card, even mid-exit-animation', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onSwipeRight = vi.fn();
    const { rerender } = render(
      <SwipeDeck items={[jobOne, jobTwo]} onDismiss={onDismiss} onSwipeRight={onSwipeRight} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();

    // Parent already reflects job-1's removal (e.g. the discover feed's own
    // optimistic-removal cache update) before job-1's own 200ms exit
    // animation has actually finished.
    rerender(<SwipeDeck items={[jobTwo]} onDismiss={onDismiss} onSwipeRight={onSwipeRight} />);

    expect(screen.getByRole('heading', { name: 'Job Two' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled();
  });

  describe('drag gestures', () => {
    it('swipes right (calls onSwipeRight) after the exit animation when dragged past the threshold to the right', () => {
      vi.useFakeTimers();
      const { onSwipeRight, container } = renderDeck([jobOne]);

      dragCard(getDragHandle(container), 200);
      expect(onSwipeRight).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(200));
      expect(onSwipeRight).toHaveBeenCalledTimes(1);
      expect(onSwipeRight).toHaveBeenCalledWith('job-1');
    });

    it('dismisses (calls onDismiss) after the exit animation when dragged past the threshold to the left', () => {
      vi.useFakeTimers();
      const { onDismiss, container } = renderDeck([jobOne]);

      dragCard(getDragHandle(container), -200);
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(200));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledWith('job-1');
    });

    it('snaps back without calling onDismiss or onSwipeRight when released before the drag threshold is reached', () => {
      vi.useFakeTimers();
      const { onDismiss, onSwipeRight, container } = renderDeck([jobOne]);

      dragCard(getDragHandle(container), 50);
      act(() => vi.advanceTimersByTime(200));

      expect(onDismiss).not.toHaveBeenCalled();
      expect(onSwipeRight).not.toHaveBeenCalled();
    });

    it('does not double-fire onDismiss when a second drag is started immediately after a swipe-left exit is already in progress', () => {
      vi.useFakeTimers();
      const { onDismiss, onSwipeRight, container } = renderDeck([jobOne]);
      const handle = getDragHandle(container);

      dragCard(handle, -200);
      // Second drag attempted before the first exit animation (200ms) has
      // resolved — triggerExit's `if (exitDirection) return;` guard should
      // make this a no-op, same as the existing double-arrow-key test.
      dragCard(handle, -200, 2);

      act(() => vi.advanceTimersByTime(200));

      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onSwipeRight).not.toHaveBeenCalled();
    });

    it('ignores a second pointer that lands mid-drag, so it cannot corrupt the drag driven by the first pointer', () => {
      vi.useFakeTimers();
      const { onDismiss, onSwipeRight, container } = renderDeck([jobOne]);
      const handle = getDragHandle(container);

      // Pointer A starts a drag rightward, short of the threshold.
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50 });

      // Pointer B (e.g. a second touch point) lands on the card while A's
      // drag is still active — must be ignored entirely, not overwrite the
      // drag's baseline.
      fireEvent.pointerDown(handle, { pointerId: 2, clientX: 500 });
      fireEvent.pointerMove(handle, { pointerId: 2, clientX: -500 });
      fireEvent.pointerUp(handle, { pointerId: 2, clientX: -500 });

      // Pointer A's own release should still be evaluated against its own
      // baseline (delta 50, under the 120px threshold) — not corrupted by
      // pointer B's clientX values.
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 50 });
      act(() => vi.advanceTimersByTime(200));

      expect(onDismiss).not.toHaveBeenCalled();
      expect(onSwipeRight).not.toHaveBeenCalled();
    });
  });
});

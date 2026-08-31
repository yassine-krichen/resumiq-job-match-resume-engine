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
});

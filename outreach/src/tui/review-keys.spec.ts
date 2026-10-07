import { initialViewState, reduceKey } from './review-keys';
import type { KeyInput, ViewState } from './review-keys';

function press(state: ViewState, input: string, rest: Partial<KeyInput> = {}, visible = 5): ReturnType<typeof reduceKey> {
  return reduceKey(state, { input, ...rest }, visible);
}

describe('review keymap: browsing', () => {
  it('moves down with the arrow, j and n, and up with the arrow and p, staying inside the list', () => {
    let state = initialViewState();
    state = press(state, '', { downArrow: true }).state;
    state = press(state, 'j').state;
    state = press(state, 'n').state;
    expect(state.cursor).toBe(3);
    state = press(state, '', { upArrow: true }).state;
    state = press(state, 'p').state;
    expect(state.cursor).toBe(1);

    expect(press(initialViewState(), '', { upArrow: true }).state.cursor).toBe(0);
    expect(press({ ...initialViewState(), cursor: 4 }, 'j').state.cursor).toBe(4);
  });

  it('resets the detail scroll when the selection changes', () => {
    const scrolled = { ...initialViewState(), detailScroll: 16 };
    expect(press(scrolled, 'j').state.detailScroll).toBe(0);
  });

  it('scrolls the detail pane with page keys and never above the top', () => {
    const down = press(initialViewState(), '', { pageDown: true }).state;
    expect(down.detailScroll).toBeGreaterThan(0);
    expect(press(down, '', { pageUp: true }).state.detailScroll).toBe(0);
    expect(press(initialViewState(), '', { pageUp: true }).state.detailScroll).toBe(0);
  });

  it.each([
    ['a', 'approve'],
    ['e', 'edit'],
    ['o', 'open'],
    ['r', 'retry'],
    ['q', 'quit'],
  ])('maps %s to the %s command', (key, command) => {
    expect(press(initialViewState(), key).command).toBe(command);
  });

  it('keeps k for kill, not for moving up', () => {
    const outcome = press({ ...initialViewState(), cursor: 2 }, 'k');
    expect(outcome.state.cursor).toBe(2);
    expect(outcome.state.mode).toBe('confirm');
    expect(outcome.state.pending).toBe('kill');
    expect(outcome.command).toBeNull();
  });

  it('does nothing for item commands on an empty list, but still quits', () => {
    for (const key of ['a', 'A', 'e', 'o', 'k', 'r']) {
      const outcome = press(initialViewState(), key, {}, 0);
      expect(outcome.command).toBeNull();
      expect(outcome.state.mode).toBe('browse');
    }
    expect(press(initialViewState(), 'q', {}, 0).command).toBe('quit');
  });

  it('ignores control and meta chords so ctrl+a is not approve', () => {
    expect(press(initialViewState(), 'a', { ctrl: true }).command).toBeNull();
    expect(press(initialViewState(), 'q', { meta: true }).command).toBeNull();
  });
});

describe('review keymap: confirmations', () => {
  it('approves all visible only after y', () => {
    const asked = press(initialViewState(), 'A').state;
    expect(asked).toMatchObject({ mode: 'confirm', pending: 'approve-all' });

    const confirmed = press(asked, 'y');
    expect(confirmed.command).toBe('approve-all');
    expect(confirmed.state.mode).toBe('browse');
  });

  it('kills only after y', () => {
    const asked = press(initialViewState(), 'k').state;
    expect(press(asked, 'y').command).toBe('kill');
  });

  it('cancels on any other key and runs nothing', () => {
    const asked = press(initialViewState(), 'k').state;
    for (const key of ['n', 'q', 'a', '']) {
      const outcome = press(asked, key);
      expect(outcome.command).toBeNull();
      expect(outcome.state).toMatchObject({ mode: 'browse', pending: null });
    }
  });
});

describe('review keymap: filter', () => {
  it('collects typed text, edits it with backspace and returns the cursor to the top', () => {
    let state: ViewState = { ...initialViewState('', 3) };
    state = press(state, '/').state;
    expect(state.mode).toBe('filter');
    for (const char of 'fra') state = press(state, char).state;
    expect(state).toMatchObject({ filter: 'fra', cursor: 0 });
    state = press(state, '', { backspace: true }).state;
    state = press(state, '', { delete: true }).state;
    state = press(state, '', { backspace: true }).state;
    expect(state.filter).toBe('');
  });

  it('does not treat letters typed in the filter as commands', () => {
    let state = press(initialViewState(), '/').state;
    const outcome = press(state, 'q');
    state = outcome.state;
    expect(outcome.command).toBeNull();
    expect(state.filter).toBe('q');
  });

  it('keeps the filter on enter and clears it on escape', () => {
    let state = press(initialViewState(), '/').state;
    state = press(state, 'x').state;
    expect(press(state, '', { return: true }).state).toMatchObject({ mode: 'browse', filter: 'x' });
    expect(press(state, '', { escape: true }).state).toMatchObject({ mode: 'browse', filter: '' });
  });
});

describe('review keymap: a on a needs_manual company', () => {
  const flagged = { needsManual: true };

  it('asks for confirmation instead of approving', () => {
    const outcome = reduceKey(initialViewState(), { input: 'a' }, 5, flagged);

    expect(outcome.command).toBeNull();
    expect(outcome.state).toMatchObject({ mode: 'confirm', pending: 'approve-despite' });
  });

  it('approves despite the reasons only after y', () => {
    const asked = reduceKey(initialViewState(), { input: 'a' }, 5, flagged).state;

    expect(reduceKey(asked, { input: 'y' }, 5, flagged).command).toBe('approve-despite');
    expect(reduceKey(asked, { input: 'Y' }, 5, flagged).command).toBe('approve-despite');
  });

  it('cancels on any other key and on enter, which is the safe default of y/N', () => {
    const asked = reduceKey(initialViewState(), { input: 'a' }, 5, flagged).state;

    for (const key of [{ input: 'n' }, { input: '' }, { input: '', return: true }, { input: 'a' }]) {
      const outcome = reduceKey(asked, key, 5, flagged);
      expect(outcome.command).toBeNull();
      expect(outcome.state).toMatchObject({ mode: 'browse', pending: null });
    }
  });

  it('keeps a as a plain approve for other companies', () => {
    expect(reduceKey(initialViewState(), { input: 'a' }, 5, { needsManual: false }).command).toBe('approve');
    expect(reduceKey(initialViewState(), { input: 'a' }, 5).command).toBe('approve');
  });

  it('leaves e (edit) and k (kill) as they are', () => {
    expect(reduceKey(initialViewState(), { input: 'e' }, 5, flagged).command).toBe('edit');
    expect(reduceKey(initialViewState(), { input: 'k' }, 5, flagged).state.pending).toBe('kill');
  });
});

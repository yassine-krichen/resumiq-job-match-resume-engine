// The review screen's keymap as a pure reducer: keys in, new view state and (maybe) a command out. The
// screen only forwards keys and runs the commands, so every binding is tested without a terminal.
//
// `k` is kill (SPEC section 9), so moving up is the arrow key or `p`; down is the arrow key, `j` or `n`.

export type ReviewCommand = 'approve' | 'approve-despite' | 'approve-all' | 'edit' | 'kill' | 'open' | 'retry' | 'quit';
export type PendingConfirmation = 'kill' | 'approve-all' | 'approve-despite';

export interface KeyInput {
  input: string;
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface ViewState {
  /** Index into the visible (filtered) list. */
  cursor: number;
  filter: string;
  mode: 'browse' | 'filter' | 'confirm';
  pending: PendingConfirmation | null;
  /** First visible line of the detail pane. */
  detailScroll: number;
}

export const DETAIL_PAGE_LINES = 8;

export function initialViewState(filter = '', cursor = 0): ViewState {
  return { cursor, filter, mode: 'browse', pending: null, detailScroll: 0 };
}

export function clampCursor(cursor: number, visibleCount: number): number {
  return Math.max(0, Math.min(cursor, visibleCount - 1));
}

export interface KeyOutcome {
  state: ViewState;
  command: ReviewCommand | null;
}

function move(state: ViewState, delta: number, visibleCount: number): KeyOutcome {
  return { state: { ...state, cursor: clampCursor(state.cursor + delta, visibleCount), detailScroll: 0 }, command: null };
}

function reduceFilterKey(state: ViewState, key: KeyInput): KeyOutcome {
  if (key.return) return { state: { ...state, mode: 'browse' }, command: null };
  if (key.escape) return { state: { ...state, mode: 'browse', filter: '', cursor: 0, detailScroll: 0 }, command: null };
  if (key.backspace || key.delete) {
    return { state: { ...state, filter: state.filter.slice(0, -1), cursor: 0, detailScroll: 0 }, command: null };
  }
  if (key.input && !key.ctrl && !key.meta) {
    return { state: { ...state, filter: state.filter + key.input, cursor: 0, detailScroll: 0 }, command: null };
  }
  return { state, command: null };
}

function reduceConfirmKey(state: ViewState, key: KeyInput): KeyOutcome {
  const confirmed = key.input === 'y' || key.input === 'Y';
  const cancelled: ViewState = { ...state, mode: 'browse', pending: null };
  return { state: cancelled, command: confirmed ? state.pending : null };
}

/** What the reducer needs to know about the selected row. */
export interface CurrentRow {
  /** A stage flagged this company: `a` must ask before approving. */
  needsManual: boolean;
}

export function reduceKey(state: ViewState, key: KeyInput, visibleCount: number, current?: CurrentRow): KeyOutcome {
  if (state.mode === 'filter') return reduceFilterKey(state, key);
  if (state.mode === 'confirm') return reduceConfirmKey(state, key);

  if (key.upArrow || key.input === 'p') return move(state, -1, visibleCount);
  if (key.downArrow || key.input === 'j' || key.input === 'n') return move(state, 1, visibleCount);
  if (key.pageDown) return { state: { ...state, detailScroll: state.detailScroll + DETAIL_PAGE_LINES }, command: null };
  if (key.pageUp) {
    return { state: { ...state, detailScroll: Math.max(0, state.detailScroll - DETAIL_PAGE_LINES) }, command: null };
  }
  if (key.ctrl || key.meta) return { state, command: null };

  switch (key.input) {
    case '/':
      return { state: { ...state, mode: 'filter' }, command: null };
    case 'q':
      return { state, command: 'quit' };
    case 'a':
      if (visibleCount === 0) return { state, command: null };
      // Approving over a flagged reason is a deliberate act: y/N first, enter or any other key cancels.
      if (current?.needsManual) return { state: { ...state, mode: 'confirm', pending: 'approve-despite' }, command: null };
      return { state, command: 'approve' };
    case 'e':
      return { state, command: visibleCount > 0 ? 'edit' : null };
    case 'o':
      return { state, command: visibleCount > 0 ? 'open' : null };
    case 'r':
      return { state, command: visibleCount > 0 ? 'retry' : null };
    case 'A':
      return visibleCount > 0
        ? { state: { ...state, mode: 'confirm', pending: 'approve-all' }, command: null }
        : { state, command: null };
    case 'k':
      return visibleCount > 0
        ? { state: { ...state, mode: 'confirm', pending: 'kill' }, command: null }
        : { state, command: null };
    default:
      return { state, command: null };
  }
}

export const KEY_HINTS = [
  ['↑↓', 'move'],
  ['a', 'approve'],
  ['A', 'approve all'],
  ['e', 'edit'],
  ['k', 'kill'],
  ['o', 'open pdf'],
  ['r', 'retry send'],
  ['/', 'filter'],
  ['q', 'quit'],
] as const;

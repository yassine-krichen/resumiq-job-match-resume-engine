import { useState } from 'react';
import type * as InkModule from 'ink';

import type { ActionResult } from './review-actions';
import { buildDetailLines, truncate } from './detail-lines';
import type { LineTone } from './detail-lines';
import { countryOf, filterItems, fitScore, isLowConfidence } from './review-items';
import type { PipelineSummary, ReviewItem } from './review-items';
import { KEY_HINTS, clampCursor, reduceKey } from './review-keys';
import type { ReviewCommand, ViewState } from './review-keys';

// The screen. It owns no rules: keys go through reduceKey, text comes from buildDetailLines, and actions are
// the handlers passed in. Ink is ESM-only, so it arrives as an argument (see esm-import.ts) instead of an import.

type Ink = typeof InkModule;

// Muted, low-saturation palette with one accent: the point of the screen is the email, not the chrome.
const PALETTE = {
  text: '#cdd6f4',
  muted: '#7f849c',
  border: '#585b70',
  accent: '#cba6f7',
  good: '#a6e3a1',
  warn: '#f9e2af',
  bad: '#f38ba8',
  link: '#89b4fa',
} as const;

const TONE_COLOR: Record<LineTone, string> = {
  title: PALETTE.text,
  label: PALETTE.accent,
  body: PALETTE.text,
  muted: PALETTE.muted,
  warn: PALETTE.warn,
  good: PALETTE.good,
  link: PALETTE.link,
};

export interface ReviewSnapshot {
  items: ReviewItem[];
  pipeline: PipelineSummary;
}

export type ScreenExit = { kind: 'quit' } | { kind: 'edit'; companyId: string };

export interface ReviewHandlers {
  /** Runs approve / approve-all / kill / open against the store and reports what happened. */
  run(command: Exclude<ReviewCommand, 'edit' | 'quit'>, current: ReviewItem | null, visible: ReviewItem[]): Promise<ActionResult>;
  reload(): Promise<ReviewSnapshot>;
}

export interface ReviewScreenProps {
  initial: ReviewSnapshot;
  view: ViewState;
  notice: ActionResult | null;
  handlers: ReviewHandlers;
  onExit(exit: ScreenExit, view: ViewState): void;
}

const GLYPH: Record<string, string> = { approved: '✓', scheduled: '»', needs_manual: '?' };
// Appended to the list row of a sourced contact whose address was guessed or scored low.
const LOW_CONFIDENCE_MARK = ' @?';
const FAILED_GLYPH = '✗';

export function createReviewScreen(ink: Ink): (props: ReviewScreenProps) => React.JSX.Element {
  const { Box, Text, useApp, useInput, useStdout } = ink;

  function PipelineStrip({ pipeline }: { pipeline: PipelineSummary }): React.JSX.Element {
    return (
      <Box borderStyle="round" borderColor={PALETTE.border} paddingX={1} justifyContent="space-between">
        <Box>
          {pipeline.counts.length === 0 ? <Text color={PALETTE.muted}>no companies yet</Text> : null}
          {pipeline.counts.map((entry, index) => (
            <Box key={entry.status}>
              {index > 0 ? <Text color={PALETTE.border}> · </Text> : null}
              <Text color={PALETTE.muted}>{entry.status} </Text>
              <Text color={entry.status === 'awaiting_review' ? PALETTE.accent : PALETTE.text} bold={entry.status === 'awaiting_review'}>
                {entry.count}
              </Text>
            </Box>
          ))}
        </Box>
        <Text>
          {pipeline.failedSends > 0 ? <Text color={PALETTE.bad}>{`failed sends ${pipeline.failedSends}  `}</Text> : null}
          <Text color={PALETTE.muted}>today </Text>
          <Text color={PALETTE.text}>
            {pipeline.sentToday}/{pipeline.dailyCap}
          </Text>
        </Text>
      </Box>
    );
  }

  function ListRow({ item, selected, width }: { item: ReviewItem; selected: boolean; width: number }): React.JSX.Element {
    const fit = fitScore(item);
    const language = item.draft?.language ?? item.dossier?.data.language ?? '--';
    const lowConfidence = isLowConfidence(item.contact);
    const meta = `${countryOf(item)} ${language} ${fit ?? '?'}${item.draft?.generic ? ' gen' : ''}${lowConfidence ? LOW_CONFIDENCE_MARK : ''}`;
    const needsManual = item.company.status === 'needs_manual';
    const glyph = item.failedSend ? FAILED_GLYPH : (GLYPH[item.company.status] ?? ' ');
    const nameWidth = Math.max(6, width - meta.length - 5);
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text>
            <Text color={PALETTE.accent}>{selected ? '›' : ' '}</Text>
            <Text
              color={
                item.failedSend ? PALETTE.bad : needsManual ? PALETTE.warn : item.company.status === 'awaiting_review' ? PALETTE.muted : PALETTE.good
              }
            >
              {' '}
              {glyph}{' '}
            </Text>
            <Text color={selected ? PALETTE.accent : PALETTE.text} bold={selected}>
              {truncate(item.company.name, nameWidth)}
            </Text>
          </Text>
          <Text color={item.failures.length > 0 ? PALETTE.bad : item.draft?.generic || lowConfidence ? PALETTE.warn : PALETTE.muted}>{meta}</Text>
        </Box>
        <Text color={needsManual ? PALETTE.warn : PALETTE.muted}>
          {`    ${truncate(needsManual ? (item.manualReason ?? '') : (item.draft?.subject ?? ''), width - 4)}`}
        </Text>
      </Box>
    );
  }

  function ItemList(props: { items: ReviewItem[]; cursor: number; width: number; height: number }): React.JSX.Element {
    const { items, cursor, width, height } = props;
    const rowsFit = Math.max(1, Math.floor((height - 3) / 2));
    const start = Math.max(0, Math.min(cursor - Math.floor(rowsFit / 2), items.length - rowsFit));
    const shown = items.slice(start, start + rowsFit);
    return (
      <Box borderStyle="round" borderColor={PALETTE.border} flexDirection="column" width={width} height={height} paddingX={1}>
        <Text color={PALETTE.muted}>
          drafts <Text color={PALETTE.text}>{items.length}</Text>
        </Text>
        {items.length === 0 ? <Text color={PALETTE.muted}>nothing to review</Text> : null}
        {shown.map((item, index) => (
          <ListRow key={item.company.id} item={item} selected={start + index === cursor} width={width - 4} />
        ))}
      </Box>
    );
  }

  function Detail(props: { item: ReviewItem | null; width: number; height: number; scroll: number }): React.JSX.Element {
    const { item, width, height, scroll } = props;
    const inner = Math.max(1, height - 2);
    const lines = item ? buildDetailLines(item, width - 2) : [];
    const top = Math.min(scroll, Math.max(0, lines.length - inner));
    const window = lines.slice(top, top + inner);
    const more = lines.length > top + inner;
    return (
      <Box borderStyle="round" borderColor={PALETTE.border} flexDirection="column" width={width} height={height} paddingX={1}>
        {window.map((line, index) => (
          <Text
            key={`${top + index}`}
            color={TONE_COLOR[line.tone]}
            bold={line.tone === 'title' || line.tone === 'label'}
            dimColor={line.tone === 'muted'}
          >
            {index === inner - 1 && more ? '↓ more (PgDn)' : line.text || ' '}
          </Text>
        ))}
      </Box>
    );
  }

  function Footer(props: { view: ViewState; visibleCount: number; current: ReviewItem | null }): React.JSX.Element {
    const { view, visibleCount, current } = props;
    if (view.mode === 'filter') {
      return (
        <Box paddingX={1}>
          <Text color={PALETTE.accent}>/ </Text>
          <Text color={PALETTE.text}>{view.filter}</Text>
          <Text color={PALETTE.accent}>▌</Text>
          <Text color={PALETTE.muted}>
            {'   '}enter keep · esc clear · words match name, country, language, subject · generic · tailored · fit&gt;=4
          </Text>
        </Box>
      );
    }
    if (view.mode === 'confirm') {
      const question =
        view.pending === 'kill'
          ? `Kill ${current?.company.name ?? 'this company'}? It will never be emailed.`
          : view.pending === 'approve-despite'
            ? `Approve despite: ${truncate(current?.manualReason ?? 'the flagged reasons', 100)}?`
            : `Approve all ${visibleCount} visible drafts that pass their checks and the blind verifier? (low-confidence contacts are left)`;
      return (
        <Box paddingX={1}>
          <Text color={PALETTE.warn}>{question} </Text>
          <Text color={PALETTE.muted}>[y/N] y to confirm, any other key cancels</Text>
        </Box>
      );
    }
    return (
      <Box paddingX={1}>
        {KEY_HINTS.map(([key, label], index) => (
          <Box key={key}>
            {index > 0 ? <Text color={PALETTE.border}> · </Text> : null}
            <Text color={PALETTE.accent} bold>
              {key}
            </Text>
            <Text color={PALETTE.muted}> {label}</Text>
          </Box>
        ))}
        {view.filter ? <Text color={PALETTE.muted}>{`   filter: ${view.filter}`}</Text> : null}
      </Box>
    );
  }

  return function ReviewScreen(props: ReviewScreenProps): React.JSX.Element {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const [snapshot, setSnapshot] = useState<ReviewSnapshot>(props.initial);
    const [view, setView] = useState<ViewState>(props.view);
    const [notice, setNotice] = useState<ActionResult | null>(props.notice);
    const [busy, setBusy] = useState(false);

    const visible = filterItems(snapshot.items, view.filter);
    const cursor = clampCursor(view.cursor, visible.length);
    const current = visible[cursor] ?? null;

    async function execute(command: Exclude<ReviewCommand, 'edit' | 'quit'>): Promise<void> {
      setBusy(true);
      try {
        const result = await props.handlers.run(command, current, visible);
        setNotice(result);
        setSnapshot(await props.handlers.reload());
        // Approving moves on to the next draft, which is what reviewing a stack of them wants.
        if ((command === 'approve' || command === 'approve-despite') && result.ok) setView((state) => ({ ...state, cursor: state.cursor + 1, detailScroll: 0 }));
      } catch (error) {
        setNotice({ ok: false, message: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    }

    useInput((input, key) => {
      if (busy) return;
      const outcome = reduceKey({ ...view, cursor }, { input, ...key }, visible.length, {
        needsManual: current?.company.status === 'needs_manual',
      });
      setView(outcome.state);
      if (outcome.command === null) return;
      if (outcome.command !== 'edit' && outcome.command !== 'quit' && outcome.command !== 'open') setNotice(null);
      if (outcome.command === 'quit') {
        props.onExit({ kind: 'quit' }, outcome.state);
        exit();
      } else if (outcome.command === 'edit') {
        if (!current) return;
        if (!current.draft) {
          setNotice({ ok: false, message: `${current.company.name} has no draft to edit; k kills it` });
          return;
        }
        props.onExit({ kind: 'edit', companyId: current.company.id }, outcome.state);
        exit();
      } else {
        void execute(outcome.command);
      }
    });

    const columns = stdout.columns || 100;
    const rows = stdout.rows || 30;
    // strip (3) + notice (1) + footer (1)
    const bodyHeight = Math.max(8, rows - 5);
    const listWidth = Math.max(38, Math.floor(columns * 0.42));
    const detailWidth = Math.max(30, columns - listWidth);

    return (
      <Box flexDirection="column" width={columns}>
        <PipelineStrip pipeline={snapshot.pipeline} />
        <Box>
          <ItemList items={visible} cursor={cursor} width={listWidth} height={bodyHeight} />
          <Detail item={current} width={detailWidth} height={bodyHeight} scroll={view.detailScroll} />
        </Box>
        <Box paddingX={1}>
          {busy ? <Text color={PALETTE.muted}>working...</Text> : null}
          {!busy && notice ? <Text color={notice.ok ? PALETTE.good : PALETTE.bad}>{notice.message}</Text> : null}
          {!busy && !notice ? <Text> </Text> : null}
        </Box>
        <Footer view={view} visibleCount={visible.length} current={current} />
      </Box>
    );
  };
}

import { createInterface } from 'node:readline/promises';

import { createElement } from 'react';
import type * as InkModule from 'ink';

import type { OutreachPaths } from '../config/paths';
import type { OutreachStore } from '../db/outreach-store';
import type { MasterDB } from '../resume/master-db';
import { resolveResumePath } from '../send/resume-file';
import { RunLayout } from '../services/run-layout';
import { isDraftVerified } from '../services/verify-stage.service';

import { formatEditDocument, parseEditDocument } from './edit-document';
import { importEsm } from './esm-import';
import { editInEditor, openFile } from './external-programs';
import { applyEdit, approveAll, approveDespite, approveItem, emailOf, killItem, retryFailedSend } from './review-actions';
import type { ActionResult } from './review-actions';
import { createReviewScreen } from './review-app';
import type { ReviewHandlers, ReviewSnapshot, ScreenExit } from './review-app';
import { loadPipeline, loadReviewItems } from './review-items';
import type { ReviewContext, ReviewItem } from './review-items';
import { initialViewState } from './review-keys';
import type { ViewState } from './review-keys';

export interface ReviewDeps extends ReviewContext {
  store: OutreachStore;
  paths: OutreachPaths;
  now?: () => Date;
}

const ENTER_ALTERNATE_SCREEN = '\x1b[?1049h\x1b[H';
const LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l';

async function loadSnapshot(deps: ReviewDeps): Promise<ReviewSnapshot> {
  const [items, pipeline] = await Promise.all([
    loadReviewItems(deps.store, deps),
    loadPipeline(deps.store, deps.config, (deps.now ?? (() => new Date()))()),
  ]);
  return { items, pipeline };
}

/** Whether the blind verifier passed this exact draft (its report sits in the run folder). */
async function isVerified(deps: ReviewDeps, item: ReviewItem): Promise<boolean> {
  if (!item.draft) return false;
  try {
    return await isDraftVerified(new RunLayout(deps.paths, item.company.runId), item.company.slug, item.draft.id);
  } catch {
    // A run id that is not a valid folder name has no report: treat it as not verified.
    return false;
  }
}

function handlersFor(deps: ReviewDeps): ReviewHandlers {
  return {
    reload: () => loadSnapshot(deps),
    async run(command, current, visible): Promise<ActionResult> {
      if (command === 'approve-all') return approveAll(deps.store, visible, (item) => isVerified(deps, item));
      if (current === null) return { ok: false, message: 'nothing selected' };
      if (command === 'approve') return approveItem(deps.store, current);
      if (command === 'approve-despite') return approveDespite(deps.store, current);
      if (command === 'kill') return killItem(deps.store, current);
      if (command === 'retry') return retryFailedSend(deps.store, current, { ...deps, now: deps.now ?? (() => new Date()) });
      if (!current.draft) return { ok: false, message: `${current.company.name} has no draft, so there is no resume to open` };
      try {
        const file = resolveResumePath(deps.paths.root, current.draft.resumePdfPath);
        openFile(file);
        return { ok: true, message: `opening ${current.draft.resumePdfPath}` };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

async function askToRetry(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Edit again with your text kept? [Y/n] ');
    return !/^n/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

/**
 * Edit round trip, run with the terminal released: editor on a temp file, then the same checks the writer's
 * draft passed. A failed check prints why, stores nothing and offers to reopen the editor on the edited text.
 */
async function editItem(deps: ReviewDeps, item: ReviewItem): Promise<ActionResult> {
  if (!item.draft) return { ok: false, message: `${item.company.name} has no draft to edit` };
  let text = formatEditDocument(emailOf(item));
  for (;;) {
    let saved: string;
    try {
      saved = await editInEditor(text, item.company.slug);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }

    const parsed = parseEditDocument(saved);
    const problems: string[] = [];
    if (!parsed.ok) problems.push(...parsed.errors);
    else {
      const result = await applyEdit(deps.store, item, parsed.email, deps);
      if (result.ok) return { ok: true, message: result.message };
      problems.push(result.message, ...result.failures);
    }

    console.log(`\nNot saved (${item.company.name}):`);
    for (const problem of problems) console.log(`  - ${problem}`);
    if (!(await askToRetry())) return { ok: false, message: `edit of ${item.company.name} discarded` };
    text = saved;
  }
}

/** Checked before the database is opened, so a pipe or a scheduled task fails without connecting to anything. */
export function assertInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('review needs an interactive terminal (stdin and stdout must be a TTY)');
  }
}

/** The review screen loop: show the screen; on `e` leave it, run the editor, come back to the same row. */
export async function runReview(deps: ReviewDeps): Promise<void> {
  assertInteractiveTerminal();
  const ink = await importEsm<typeof InkModule>('ink');
  const ReviewScreen = createReviewScreen(ink);
  const handlers = handlersFor(deps);

  let view: ViewState = initialViewState();
  let notice: ActionResult | null = null;

  for (;;) {
    const initial = await loadSnapshot(deps);
    let exit: ScreenExit = { kind: 'quit' };

    process.stdout.write(ENTER_ALTERNATE_SCREEN);
    try {
      const app = ink.render(
        createElement(ReviewScreen, {
          initial,
          view,
          notice,
          handlers,
          onExit: (requested, finalView) => {
            exit = requested;
            view = finalView;
          },
        }),
      );
      await app.waitUntilExit();
    } finally {
      process.stdout.write(LEAVE_ALTERNATE_SCREEN);
    }

    if (exit.kind === 'quit') return;
    const { companyId } = exit;
    const item = (await loadReviewItems(deps.store, deps)).find((candidate) => candidate.company.id === companyId);
    notice = item ? await editItem(deps, item) : { ok: false, message: 'that draft is no longer in review' };
  }
}

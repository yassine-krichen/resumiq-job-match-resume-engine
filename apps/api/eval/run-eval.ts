// Runs the fabrication evaluation: for each (posting, repeat) one selectAndDraft
// (arm A, no critique) and one critiqueAndRevise of that same draft (arm B),
// then a blind judge call per arm. Every step is cached to JSONL so the run
// can be killed and resumed without repeating finished calls.
//
// Usage (from apps/api):
//   npx ts-node --transpile-only eval/run-eval.ts --run smoke --n 2 --repeats 1
//   npx ts-node --transpile-only eval/run-eval.ts --run full
// Resume: run the same command again. infra_error steps are retried.
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { critiqueAndRevise, selectAndDraft } from '@resumiq/ai-bridge';
import type { AISelection, JobDNA } from '@resumiq/ai-bridge';

import { StepCache, stepKey } from './cache';
import { EVAL_CONFIG, PATHS } from './config';
import type { Posting } from './eval.types';
import { buildIndex } from './grounding/inventory-index';
import { loadInventory } from './inventory';
import { judgeSelection } from './judge';
import { installCapture } from './llm-capture';
import { CircuitBreaker, FatalEvalError } from './retry';
import { mapLimit, runStep } from './step-runner';

// Judge calls get their own concurrency cap, separate from generation.
let judgeActive = 0;
const judgeWaiters: Array<() => void> = [];
const JUDGE_CONCURRENCY = 2;
async function limitedJudge<T>(fn: () => Promise<T>): Promise<T> {
  while (judgeActive >= JUDGE_CONCURRENCY) await new Promise<void>((r) => judgeWaiters.push(r));
  judgeActive++;
  try {
    return await fn();
  } finally {
    judgeActive--;
    judgeWaiters.shift()?.();
  }
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  if (!process.env.FREELLMAPI_API_KEY) throw new Error('FREELLMAPI_API_KEY is not set');
  const runName = arg('run', 'full');
  const n = Number(arg('n', String(EVAL_CONFIG.postings)));
  const repeats = Number(arg('repeats', String(EVAL_CONFIG.repeats)));
  const concurrency = Number(arg('concurrency', String(EVAL_CONFIG.concurrency)));

  const postings = JSON.parse(
    fs.readFileSync(path.join(PATHS.fixtures, 'postings.json'), 'utf8'),
  ) as Posting[];
  const derived = new StepCache(path.join(PATHS.fixtures, 'derived-steps.jsonl'));
  const cache = new StepCache(path.join(PATHS.out, runName, 'records.jsonl'));
  const breaker = new CircuitBreaker();
  const inventory = loadInventory();

  const usable = postings
    .slice(0, n)
    .map((p) => ({ posting: p, rec: derived.get(stepKey(p.id, 0, 'jobdna')) }))
    .filter((x) => x.rec?.status === 'ok')
    .map((x) => ({ posting: x.posting, dna: x.rec?.result as JobDNA }));
  console.error(
    `run=${runName} postings=${usable.length}/${Math.min(n, postings.length)} repeats=${repeats} concurrency=${concurrency}`,
  );

  installCapture();
  const units = Array.from({ length: repeats }, (_, r) =>
    usable.map((u) => ({ ...u, repeat: r + 1 })),
  ).flat();

  await mapLimit(units, concurrency, async ({ posting, dna, repeat }) => {
    const index = buildIndex(inventory.db, [
      ...dna.mandatory_technical_skills,
      ...dna.nice_to_have_skills,
    ]);
    const base = { postingId: posting.id, repeat, cache, breaker };

    const draft = await runStep<AISelection>({
      ...base,
      stage: 'draft',
      fn: () => selectAndDraft(dna, inventory.db, EVAL_CONFIG.pages),
    });
    if (draft.status !== 'ok') {
      console.error(`${posting.id} r${repeat} draft ${draft.status}`);
      return;
    }
    const draftSel = draft.result as AISelection;
    const critique = await runStep<AISelection>({
      ...base,
      stage: 'critique',
      fn: () => critiqueAndRevise(draftSel, dna, inventory.db),
    });
    await runStep({ ...base, stage: 'judge_a', fn: () => limitedJudge(() => judgeSelection(draftSel, index)) });
    if (critique.status === 'ok') {
      await runStep({
        ...base,
        stage: 'judge_b',
        fn: () => limitedJudge(() => judgeSelection(critique.result as AISelection, index)),
      });
    }
    console.error(`${posting.id} r${repeat} done (critique ${critique.status})`);
  });

  const recs = cache.all();
  const calls = recs.reduce((s, r) => s + r.calls.length, 0);
  const byStatus: Record<string, number> = {};
  for (const r of recs) byStatus[`${r.stage}:${r.status}`] = (byStatus[`${r.stage}:${r.status}`] ?? 0) + 1;
  console.error(`finished. http calls recorded this cache: ${calls}`);
  console.error(JSON.stringify(byStatus));
}

main().catch((err) => {
  console.error(err instanceof FatalEvalError ? `STOPPED: ${err.message}` : err);
  process.exit(1);
});

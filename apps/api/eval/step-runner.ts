import { LlmValidationError } from '@resumiq/ai-bridge';

import { stepKey } from './cache';
import type { StepCache } from './cache';
import { EVAL_CONFIG } from './config';
import type { CallInfo, Stage, StepRecord } from './eval.types';
import { JudgeValidationError } from './judge';
import { captureCalls } from './llm-capture';
import { backoffMs, CircuitBreaker, isInfraError, sleep } from './retry';

export interface StepSpec<T> {
  postingId: string;
  repeat: number;
  stage: Stage;
  cache: StepCache;
  breaker: CircuitBreaker;
  fn: () => Promise<T>;
}

/**
 * Runs one LLM-backed step with caching, runner-level backoff for transient
 * infrastructure errors, and outcome classification. Schema failures (the
 * model's output was still invalid after the library's own repair retry) are
 * final outcomes, not retried and not dropped.
 */
export async function runStep<T>(spec: StepSpec<T>): Promise<StepRecord> {
  const key = stepKey(spec.postingId, spec.repeat, spec.stage);
  const existing = spec.cache.get(key);
  if (existing && spec.cache.isFinal(key)) return existing;

  const started = Date.now();
  const calls: CallInfo[] = [];
  const maxAttempts = EVAL_CONFIG.retryBackoffMs.length + 1;
  let record: StepRecord | undefined;

  for (let attempt = 1; attempt <= maxAttempts && !record; attempt++) {
    const outcome = await captureCalls(spec.fn);
    calls.push(...outcome.calls);
    const base = {
      key,
      postingId: spec.postingId,
      repeat: spec.repeat,
      stage: spec.stage,
      calls,
      attempts: attempt,
      latencyMs: Date.now() - started,
      at: new Date().toISOString(),
    };
    if (!('error' in outcome) || outcome.error === undefined) {
      record = { ...base, status: 'ok', result: outcome.value };
      spec.breaker.recordSuccess();
    } else if (
      outcome.error instanceof LlmValidationError ||
      outcome.error instanceof JudgeValidationError
    ) {
      record = { ...base, status: 'schema_failure', error: outcome.error.message.slice(0, 400) };
      spec.breaker.recordSuccess();
    } else if (isInfraError(outcome.error) && attempt < maxAttempts) {
      await sleep(backoffMs(attempt - 1));
    } else {
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      record = { ...base, status: 'infra_error', error: message.slice(0, 400) };
    }
  }

  const final = record as StepRecord;
  spec.cache.put(final);
  if (final.status === 'infra_error') spec.breaker.recordInfraFailure();
  return final;
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

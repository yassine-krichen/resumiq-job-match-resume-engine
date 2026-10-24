import { EVAL_CONFIG } from './config';

export function isInfraError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Freellmapi HTTP (429|5\d\d)|fetch failed|timeout|aborted|ECONNRESET|ETIMEDOUT|socket/i.test(
    msg,
  );
}

export class FatalEvalError extends Error {}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Jittered exponential-ish backoff between runner-level attempts (llm.ts itself retries once after 1s). */
export function backoffMs(attempt: number): number {
  const base = EVAL_CONFIG.retryBackoffMs[Math.min(attempt, EVAL_CONFIG.retryBackoffMs.length - 1)];
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/** Counts consecutive final infra failures; trips instead of burning retries during an outage. */
export class CircuitBreaker {
  private consecutive = 0;

  recordSuccess(): void {
    this.consecutive = 0;
  }

  recordInfraFailure(): void {
    this.consecutive++;
    if (this.consecutive >= EVAL_CONFIG.circuitBreakerThreshold) {
      throw new FatalEvalError(
        `${this.consecutive} consecutive freellmapi infrastructure failures after backoff; stopping rather than burning retries. Re-run with --resume later.`,
      );
    }
  }
}

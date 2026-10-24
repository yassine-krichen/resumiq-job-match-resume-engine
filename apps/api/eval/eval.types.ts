import type { AISelection } from '@resumiq/ai-bridge';

export type Stage = 'jobdna' | 'compat' | 'draft' | 'critique' | 'judge_a' | 'judge_b';
export type StepStatus = 'ok' | 'schema_failure' | 'infra_error' | 'skipped';

export interface CallInfo {
  model: string | null;
  httpStatus: number;
  ms: number;
}

/** One cached pipeline step. The latest record per key wins. */
export interface StepRecord {
  key: string;
  postingId: string;
  repeat: number;
  stage: Stage;
  status: StepStatus;
  result?: unknown;
  error?: string;
  calls: CallInfo[];
  attempts: number;
  latencyMs: number;
  at: string;
}

export type SelectionResult = AISelection;

export type JudgeVerdictLabel = 'supported' | 'partial' | 'unsupported';

export interface JudgeVerdict {
  id: string;
  verdict: JudgeVerdictLabel;
  issue: string;
}

export interface JudgeResult {
  verdicts: JudgeVerdict[];
  /** Requested judge model; analysis ignores verdicts from any other judge. */
  judgeModel?: string;
}

export interface Posting {
  id: string;
  host: string;
  sourceUrl: string;
  title: string;
  companyName: string;
  rawJd: string;
  sha256: string;
}

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Stage, StepRecord } from './eval.types';

export function stepKey(postingId: string, repeat: number, stage: Stage): string {
  return `${postingId}|r${repeat}|${stage}`;
}

/** Append-only JSONL cache; the latest record per key wins, so a crash never loses finished steps. */
export class StepCache {
  private readonly records = new Map<string, StepRecord>();

  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as StepRecord;
        this.records.set(rec.key, rec);
      } catch {
        // A line truncated by a crash mid-write is ignored; that step reruns.
      }
    }
  }

  get(key: string): StepRecord | undefined {
    return this.records.get(key);
  }

  /** infra_error records are not final: a resumed run retries them. */
  isFinal(key: string): boolean {
    const rec = this.records.get(key);
    return rec !== undefined && rec.status !== 'infra_error';
  }

  put(rec: StepRecord): void {
    this.records.set(rec.key, rec);
    fs.appendFileSync(this.file, `${JSON.stringify(rec)}\n`);
  }

  all(): StepRecord[] {
    return [...this.records.values()];
  }
}

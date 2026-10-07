import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DateTime } from 'luxon';

// One JSON line per tick in logs/tick-YYYY-MM-DD.log (local date). Counts and error codes only: never an
// email body, a subject, an address or a token.

export interface TickLogEntry {
  at: string;
  durationMs: number;
  counts: Record<string, number | boolean | string | null>;
  errors: string[];
}

export function tickLogFile(logsDir: string, when: Date): string {
  return join(logsDir, `tick-${DateTime.fromJSDate(when).toFormat('yyyy-LL-dd')}.log`);
}

// Error text can echo a Gmail response; keep it short and drop anything that looks like a bearer token.
export function sanitizeLogText(text: string): string {
  return text
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bya29\.[\w.-]+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

export async function appendTickLog(logsDir: string, entry: TickLogEntry): Promise<string> {
  const file = tickLogFile(logsDir, new Date(entry.at));
  await mkdir(logsDir, { recursive: true });
  const line = JSON.stringify({ ...entry, errors: entry.errors.map(sanitizeLogText) });
  await appendFile(file, `${line}\n`, 'utf-8');
  return file;
}

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendTickLog, sanitizeLogText, tickLogFile } from './tick-log';

describe('tick log', () => {
  it('appends one JSON line per tick to tick-YYYY-MM-DD.log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tick-log-'));
    const entry = { at: '2026-10-12T06:30:00.000Z', durationMs: 12, counts: { sent: 2 }, errors: [] };

    const file = await appendTickLog(dir, entry);
    await appendTickLog(dir, entry);

    expect(file).toBe(tickLogFile(dir, new Date(entry.at)));
    expect(file).toMatch(/tick-2026-10-1[12]\.log$/);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ durationMs: 12, counts: { sent: 2 } });
  });

  it('redacts bearer tokens and truncates long error text', () => {
    expect(sanitizeLogText('failed: Bearer ya29.a0AfH6SMB-secret_token.xyz here')).toBe('failed: Bearer [redacted] here');
    expect(sanitizeLogText('x'.repeat(500))).toHaveLength(200);
  });
});

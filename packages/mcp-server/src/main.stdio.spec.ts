import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { tempInventory } from './test-support/fixture';

const PACKAGE_ROOT = join(__dirname, '..');

function build(): void {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
    cwd: PACKAGE_ROOT,
    stdio: 'pipe',
  });
}

function collectFrames(child: ChildProcessWithoutNullStreams, untilId: number, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`no response ${untilId} within ${timeoutMs} ms`)), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts.filter((l) => l.trim() !== '')) {
        lines.push(line);
        if ((JSON.parse(line) as { id?: number }).id === untilId) {
          clearTimeout(timer);
          resolve(lines);
        }
      }
    });
  });
}

describe('built stdio server', () => {
  beforeAll(() => {
    build();
    expect(existsSync(join(PACKAGE_ROOT, 'dist', 'main.js'))).toBe(true);
  }, 120_000);

  it('writes only JSON-RPC frames to stdout, and logs to stderr', async () => {
    const inventory = tempInventory();
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, 'dist', 'main.js')], {
      env: { ...process.env, RESUMIQ_INVENTORY_PATH: inventory.path },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf-8')));

    try {
      const frames = collectFrames(child, 2, 20_000);
      const send = (message: object): void => void child.stdin.write(`${JSON.stringify(message)}\n`);
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '0.0.0' } },
      });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

      const lines = await frames;
      const parsed = lines.map((l) => JSON.parse(l) as { jsonrpc: string; id?: number; result?: { tools?: { name: string }[] } });

      expect(parsed.every((m) => m.jsonrpc === '2.0')).toBe(true);
      expect(parsed.find((m) => m.id === 2)?.result?.tools?.map((t) => t.name).sort()).toEqual([
        'get_entry',
        'list_gaps',
        'search_profile',
      ]);
      expect(stderr).toContain('ready');
    } finally {
      child.kill();
      inventory.cleanup();
    }
  }, 60_000);
});

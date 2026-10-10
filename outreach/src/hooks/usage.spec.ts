import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The hook lives in .claude/ (plain node, no build step); its logic is CommonJS so this spec can load it.
const HOOK_DIR = resolve(__dirname, '..', '..', '.claude', 'hooks');

interface UsageApi {
  parseTranscript: (
    text: string,
    options?: { includeSidechain?: boolean },
  ) => {
    userTexts: string[];
    byModel: Record<string, { input: number; output: number; cache_write: number; cache_read: number }>;
    runMentions: string[];
  };
  identifyTask: (prompt: string) => { run: string | null; slug: string | null };
  pickRunMention: (mentions: string[]) => string | null;
  isOrchestratorSession: (userTexts: string[]) => boolean;
  recordUsage: (
    payload: Record<string, unknown>,
    io: { root: string; now?: () => Date },
  ) => { written: number; skipped: string | null };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const usage = require(join(HOOK_DIR, 'usage.cjs')) as UsageApi;

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

const assistant = (id: string | null, model: string, tokens: Usage, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'assistant',
    message: { ...(id === null ? {} : { id }), role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], usage: tokens },
    ...extra,
  });
const user = (text: string): string => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const userBlocks = (text: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const lines = (...parts: string[]): string => `${parts.join('\n')}\n`;

describe('parseTranscript', () => {
  it('sums the four usage fields per model', () => {
    const text = lines(
      user('hello'),
      assistant('m1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 }),
      assistant('m2', 'claude-opus-5-5', { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }),
      assistant('m3', 'claude-haiku-5-5', { input_tokens: 5, output_tokens: 6 }),
    );

    const { byModel } = usage.parseTranscript(text);

    expect(byModel['claude-opus-5-5']).toMatchObject({ input: 11, output: 22, cache_write: 33, cache_read: 44 });
    expect(byModel['claude-haiku-5-5']).toMatchObject({ input: 5, output: 6, cache_write: 0, cache_read: 0 });
  });

  it('counts a message once when it is streamed over several lines, keeping the largest figures', () => {
    const text = lines(
      assistant('m1', 'claude-opus-5-5', { input_tokens: 100, output_tokens: 1 }),
      assistant('m1', 'claude-opus-5-5', { input_tokens: 100, output_tokens: 250 }),
    );

    expect(usage.parseTranscript(text).byModel['claude-opus-5-5']).toMatchObject({ input: 100, output: 250 });
  });

  it('raises the output count to an estimate from what was written, because the transcript logs it at stream start', () => {
    const block = (content: unknown[]): string =>
      JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 2 }, content } });
    const text = lines(
      block([{ type: 'thinking', thinking: 'a'.repeat(400) }]),
      block([{ type: 'text', text: 'b'.repeat(1200) }]),
      block([{ type: 'tool_use', name: 'Write', input: { content: 'c'.repeat(2000) } }]),
    );

    const { output } = usage.parseTranscript(text).byModel['claude-opus-5-5'];

    // (400 + 1200 + about 2020) characters at 4 per token, not the logged 2.
    expect(output).toBeGreaterThan(890);
    expect(output).toBeLessThan(920);
  });

  it('keeps the logged output count when it is larger than the estimate', () => {
    const text = lines(assistant('m1', 'claude-opus-5-5', { input_tokens: 1, output_tokens: 5000 }));

    expect(usage.parseTranscript(text).byModel['claude-opus-5-5'].output).toBe(5000);
  });

  it('ignores synthetic and empty messages, unreadable lines and lines without usage', () => {
    const text = lines(
      'not json',
      assistant('s1', '<synthetic>', { input_tokens: 0, output_tokens: 0 }),
      JSON.stringify({ type: 'assistant', message: { id: 'x', model: 'claude-opus-5-5', content: [] } }),
      JSON.stringify({ type: 'summary' }),
      assistant('m1', 'claude-opus-5-5', { input_tokens: 3, output_tokens: 4 }),
    );

    expect(Object.keys(usage.parseTranscript(text).byModel)).toEqual(['claude-opus-5-5']);
  });

  it('skips sidechain (subagent) lines unless asked to include them', () => {
    const text = lines(
      assistant('m1', 'claude-opus-5-5', { input_tokens: 3, output_tokens: 4 }),
      assistant('m2', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 1000 }, { isSidechain: true }),
    );

    expect(usage.parseTranscript(text).byModel['claude-opus-5-5']).toMatchObject({ input: 3, output: 4 });
    expect(usage.parseTranscript(text, { includeSidechain: true }).byModel['claude-opus-5-5']).toMatchObject({ input: 1003, output: 1004 });
  });

  it('collects the first user prompts as text, from a string or from content blocks', () => {
    const text = lines(user('first'), userBlocks('second'), assistant('m1', 'claude-opus-5-5', { input_tokens: 1 }));

    expect(usage.parseTranscript(text).userTexts).toEqual(['first', 'second']);
  });

  it('collects run ids mentioned in tool calls and tool results', () => {
    const toolUse = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 1 },
        content: [{ type: 'tool_use', name: 'Agent', input: { prompt: 'run=run-20261010-0900 slug=acme-fr-7daf4d' } }],
      },
    });
    const toolResult = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: '{\n  "runId": "run-20261010-0900"\n}' }] }] },
    });

    expect(usage.parseTranscript(lines(toolUse, toolResult)).runMentions).toEqual(['run-20261010-0900', 'run-20261010-0900']);
  });
});

describe('identifyTask', () => {
  it('reads run and slug from the explicit run=<id> slug=<slug> convention', () => {
    expect(usage.identifyTask('run=run-20261010-0900 slug=acme-fr-7daf4d')).toEqual({ run: 'run-20261010-0900', slug: 'acme-fr-7daf4d' });
  });

  it('reads a sourcer task that has a run but no slug', () => {
    expect(usage.identifyTask('run=run-1 limit=20 criteria=small robotics teams')).toEqual({ run: 'run-1', slug: null });
  });

  it('rejects ids that could escape the runs folder', () => {
    expect(usage.identifyTask('run=../../etc slug=../x')).toEqual({ run: null, slug: null });
    expect(usage.identifyTask('run=run-1 slug=Acme/Evil')).toEqual({ run: 'run-1', slug: null });
  });

  it('finds nothing in a prompt without the convention', () => {
    expect(usage.identifyTask('please research acme')).toEqual({ run: null, slug: null });
  });
});

describe('pickRunMention', () => {
  it('prefers the most mentioned run and the latest on a tie', () => {
    expect(usage.pickRunMention(['run-a', 'run-b', 'run-b'])).toBe('run-b');
    expect(usage.pickRunMention(['run-a', 'run-b'])).toBe('run-b');
    expect(usage.pickRunMention([])).toBeNull();
  });
});

describe('isOrchestratorSession', () => {
  it('recognises the /outreach command in its expanded or raw form', () => {
    expect(usage.isOrchestratorSession(['You are the orchestrator of the cold-outreach pipeline. Run everything below'])).toBe(true);
    expect(usage.isOrchestratorSession(['<command-name>/outreach</command-name>'])).toBe(true);
  });

  it('does not claim an ordinary session', () => {
    expect(usage.isOrchestratorSession(['fix the failing test'])).toBe(false);
    expect(usage.isOrchestratorSession([])).toBe(false);
  });
});

describe('recordUsage', () => {
  function workspace(): { root: string; usageFile: (run: string) => string } {
    const root = mkdtempSync(join(tmpdir(), 'usage-hook-'));
    mkdirSync(join(root, 'runs', 'run-1'), { recursive: true });
    return { root, usageFile: (run) => join(root, 'runs', run, 'usage.jsonl') };
  }
  const now = (): Date => new Date('2026-10-10T10:00:00Z');
  const readLines = (file: string): Array<Record<string, unknown>> =>
    readFileSync(file, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  it('writes one line per model for a subagent, attributed to its run and slug', () => {
    const { root, usageFile } = workspace();
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(
      transcript,
      lines(
        user('run=run-1 slug=acme-fr-7daf4d'),
        assistant('m1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 }),
        assistant('m2', 'claude-haiku-5-5', { input_tokens: 1, output_tokens: 2 }),
      ),
    );

    const result = usage.recordUsage(
      { hook_event_name: 'SubagentStop', session_id: 's1', agent_id: 'a1', agent_type: 'outreach-researcher', agent_transcript_path: transcript },
      { root, now },
    );

    expect(result).toEqual({ written: 2, skipped: null });
    expect(readLines(usageFile('run-1'))).toEqual([
      {
        ts: '2026-10-10T10:00:00.000Z',
        key: 'a1',
        agent_type: 'outreach-researcher',
        slug: 'acme-fr-7daf4d',
        model: 'claude-opus-5-5',
        tokens: { input: 10, output: 20, cache_write: 30, cache_read: 40 },
      },
      {
        ts: '2026-10-10T10:00:00.000Z',
        key: 'a1',
        agent_type: 'outreach-researcher',
        slug: 'acme-fr-7daf4d',
        model: 'claude-haiku-5-5',
        tokens: { input: 1, output: 2, cache_write: 0, cache_read: 0 },
      },
    ]);
  });

  it('attributes the sourcer (a run but no slug) to the run with a null slug', () => {
    const { root, usageFile } = workspace();
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(transcript, lines(user('run=run-1 limit=20 criteria=robotics'), assistant('m1', 'claude-opus-5-5', { input_tokens: 5, output_tokens: 5 })));

    usage.recordUsage({ hook_event_name: 'SubagentStop', agent_id: 'a2', agent_type: 'outreach-sourcer', agent_transcript_path: transcript }, { root, now });

    expect(readLines(usageFile('run-1'))[0]).toMatchObject({ agent_type: 'outreach-sourcer', slug: null });
  });

  it('writes the orchestrator with a null slug, keyed by session, taking the run from its tool calls', () => {
    const { root, usageFile } = workspace();
    const transcript = join(root, 'main.jsonl');
    const spawn = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 7, output_tokens: 8 },
        content: [{ type: 'tool_use', name: 'Agent', input: { prompt: 'run=run-1 slug=acme-fr-7daf4d' } }],
      },
    });
    writeFileSync(transcript, lines(user('You are the orchestrator of the cold-outreach pipeline.'), spawn));

    const result = usage.recordUsage({ hook_event_name: 'Stop', session_id: 'sess-1', transcript_path: transcript }, { root, now });

    expect(result.written).toBe(1);
    expect(readLines(usageFile('run-1'))[0]).toMatchObject({
      key: 'sess-1',
      agent_type: 'orchestrator',
      slug: null,
      tokens: { input: 7, output: 11, cache_write: 0, cache_read: 0 },
    });
  });

  it('skips an ordinary session, a run without a folder, and a missing transcript, without throwing', () => {
    const { root } = workspace();
    const ordinary = join(root, 'ordinary.jsonl');
    writeFileSync(ordinary, lines(user('fix a test run=run-1'), assistant('m1', 'claude-opus-5-5', { input_tokens: 1 })));
    expect(usage.recordUsage({ hook_event_name: 'Stop', session_id: 's', transcript_path: ordinary }, { root, now }).written).toBe(0);

    const ghost = join(root, 'ghost.jsonl');
    writeFileSync(ghost, lines(user('run=run-404 slug=a'), assistant('m1', 'claude-opus-5-5', { input_tokens: 1 })));
    expect(usage.recordUsage({ hook_event_name: 'SubagentStop', agent_transcript_path: ghost }, { root, now })).toMatchObject({ written: 0 });

    expect(usage.recordUsage({ hook_event_name: 'SubagentStop', agent_transcript_path: join(root, 'nope.jsonl') }, { root, now })).toMatchObject({ written: 0 });
    expect(existsSync(join(root, 'runs', 'run-404'))).toBe(false);
  });

  it('falls back to the subagents folder next to the session transcript when no agent transcript path is given', () => {
    const { root, usageFile } = workspace();
    const sessionTranscript = join(root, 'proj', 'sess-9.jsonl');
    mkdirSync(join(root, 'proj', 'sess-9', 'subagents'), { recursive: true });
    writeFileSync(
      join(root, 'proj', 'sess-9', 'subagents', 'agent-a9.jsonl'),
      lines(user('run=run-1 slug=acme-fr-7daf4d'), assistant('m1', 'claude-opus-5-5', { input_tokens: 2, output_tokens: 3 })),
    );

    const result = usage.recordUsage(
      { hook_event_name: 'SubagentStop', session_id: 'sess-9', agent_id: 'a9', agent_type: 'outreach-writer', transcript_path: sessionTranscript },
      { root, now },
    );

    expect(result.written).toBe(1);
    expect(readLines(usageFile('run-1'))[0]).toMatchObject({ agent_type: 'outreach-writer', slug: 'acme-fr-7daf4d' });
  });
});

describe('record-usage hook process', () => {
  function run(input: string, root: string): { status: number | null; stdout: string } {
    const result = spawnSync(process.execPath, [join(HOOK_DIR, 'record-usage.mjs')], {
      input,
      encoding: 'utf-8',
      env: { ...process.env, OUTREACH_HOOK_ROOT: root },
    });
    return { status: result.status, stdout: result.stdout };
  }

  it('exits 0 and prints nothing for unreadable input, logging the problem to logs/hooks.log', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-hook-'));

    expect(run('not json', root)).toEqual({ status: 0, stdout: '' });
    expect(readFileSync(join(root, 'logs', 'hooks.log'), 'utf-8')).toMatch(/record-usage: .*unreadable/);
  });

  it('exits 0 and prints nothing when the transcript cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-hook-'));
    const payload = JSON.stringify({ hook_event_name: 'SubagentStop', agent_transcript_path: join(root, 'missing.jsonl') });

    expect(run(payload, root)).toEqual({ status: 0, stdout: '' });
  });

  it('records a subagent end to end', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-hook-'));
    mkdirSync(join(root, 'runs', 'run-1'), { recursive: true });
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(transcript, lines(user('run=run-1 slug=acme-fr-7daf4d'), assistant('m1', 'claude-opus-5-5', { input_tokens: 4, output_tokens: 5 })));

    const result = run(JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'outreach-writer', agent_transcript_path: transcript }), root);

    expect(result).toEqual({ status: 0, stdout: '' });
    expect(readFileSync(join(root, 'runs', 'run-1', 'usage.jsonl'), 'utf-8')).toContain('"slug":"acme-fr-7daf4d"');
  });
});

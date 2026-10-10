import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_PRICING } from './pricing';
import {
  buildCostReport,
  formatCostReport,
  formatRunSummaries,
  latestPerInvocation,
  listRunIds,
  readUsageLines,
  summarizeRuns,
} from './usage-report';
import type { UsageLine } from './usage-report';

function line(partial: Partial<UsageLine> & Pick<UsageLine, 'key' | 'agent_type' | 'slug'>): UsageLine {
  return {
    ts: '2026-10-10T10:00:00.000Z',
    model: 'claude-opus-5-5',
    tokens: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    ...partial,
  };
}

// Opus 5.5: $4 in, $20 out, $5 cache write, $0.20 cache read per MTok.
const MILLION = { input: 1_000_000, output: 0, cache_write: 0, cache_read: 0 };

describe('latestPerInvocation', () => {
  it('keeps the last line for each key and model (a Stop hook writes running totals)', () => {
    const lines = [
      line({ key: 's1', agent_type: 'orchestrator', slug: null, tokens: { ...MILLION, input: 100 } }),
      line({ key: 's1', agent_type: 'orchestrator', slug: null, tokens: { ...MILLION, input: 500 } }),
      line({ key: 's1', agent_type: 'orchestrator', slug: null, model: 'claude-haiku-5-5', tokens: { ...MILLION, input: 7 } }),
    ];

    const result = latestPerInvocation(lines);

    expect(result.map((entry) => [entry.model, entry.tokens.input])).toEqual([
      ['claude-opus-5-5', 500],
      ['claude-haiku-5-5', 7],
    ]);
  });
});

describe('buildCostReport', () => {
  const lines = [
    line({ key: 'a1', agent_type: 'outreach-researcher', slug: 'acme-fr', tokens: MILLION }), // $4
    line({ key: 'a2', agent_type: 'outreach-writer', slug: 'acme-fr', tokens: { ...MILLION, input: 0, output: 100_000 } }), // $2
    line({ key: 'a3', agent_type: 'outreach-researcher', slug: 'beta-de', tokens: MILLION }), // $4
    line({ key: 'a4', agent_type: 'outreach-sourcer', slug: null, tokens: { ...MILLION, input: 500_000 } }), // $2
    line({ key: 's1', agent_type: 'orchestrator', slug: null, tokens: { ...MILLION, input: 250_000 } }), // $1
  ];

  it('groups agents under their company and everything without a slug under overhead', () => {
    const report = buildCostReport('run-1', lines, DEFAULT_PRICING);

    expect(report.companies.map((company) => [company.slug, company.usd])).toEqual([
      ['acme-fr', 6],
      ['beta-de', 4],
    ]);
    expect(report.companies[0].agents.map((agent) => [agent.agentType, agent.usd])).toEqual([
      ['outreach-researcher', 4],
      ['outreach-writer', 2],
    ]);
    expect(report.overhead.usd).toBe(3);
    expect(report.overhead.agents.map((agent) => agent.agentType).sort()).toEqual(['orchestrator', 'outreach-sourcer']);
    expect(report.totalUsd).toBe(13);
  });

  it('averages per company with and without the overhead', () => {
    const report = buildCostReport('run-1', lines, DEFAULT_PRICING);

    expect(report.companyCount).toBe(2);
    expect(report.averagePerCompanyUsd).toBe(6.5);
    expect(report.averagePerCompanyExcludingOverheadUsd).toBe(5);
  });

  it('has no averages when no company was worked on', () => {
    const report = buildCostReport('run-1', [lines[4]], DEFAULT_PRICING);

    expect(report.averagePerCompanyUsd).toBeNull();
    expect(report.averagePerCompanyExcludingOverheadUsd).toBeNull();
    expect(report.totalUsd).toBe(1);
  });

  it('counts the invocations of an agent type and merges its models', () => {
    const more = [
      line({ key: 'x1', agent_type: 'outreach-writer', slug: 'acme-fr', tokens: { ...MILLION, input: 0, output: 100_000 } }),
      line({ key: 'x1', agent_type: 'outreach-writer', slug: 'acme-fr', model: 'claude-haiku-5-5', tokens: { ...MILLION, input: 1000 } }),
      line({ key: 'x2', agent_type: 'outreach-writer', slug: 'acme-fr', tokens: { ...MILLION, input: 0, output: 100_000 } }),
    ];

    const [company] = buildCostReport('run-1', more, DEFAULT_PRICING).companies;

    expect(company.agents).toHaveLength(1);
    expect(company.agents[0]).toMatchObject({ invocations: 2, models: ['claude-haiku-5-5', 'claude-opus-5-5'] });
    expect(company.agents[0].usd).toBeCloseTo(4.0001, 4);
  });

  it('reports a model without a price instead of guessing, and leaves it out of the USD total', () => {
    const report = buildCostReport(
      'run-1',
      [line({ key: 'a1', agent_type: 'outreach-writer', slug: 'acme-fr', model: 'mystery-model-1', tokens: MILLION })],
      DEFAULT_PRICING,
    );

    expect(report.unpricedModels).toEqual(['mystery-model-1']);
    expect(report.totalUsd).toBe(0);
    expect(report.companies[0].tokens.input).toBe(1_000_000);
  });

  it('flags a run over its budget, and only then', () => {
    expect(buildCostReport('run-1', lines, DEFAULT_PRICING, 12.99)).toMatchObject({ budgetUsd: 12.99, overBudget: true });
    expect(buildCostReport('run-1', lines, DEFAULT_PRICING, 13)).toMatchObject({ overBudget: false });
    expect(buildCostReport('run-1', lines, DEFAULT_PRICING)).toMatchObject({ budgetUsd: null, overBudget: false });
  });
});

describe('formatCostReport', () => {
  it('prints one block per company, the overhead, the total and both averages', () => {
    const report = buildCostReport(
      'run-1',
      [
        line({ key: 'a1', agent_type: 'outreach-researcher', slug: 'acme-fr', tokens: MILLION }),
        line({ key: 's1', agent_type: 'orchestrator', slug: null, tokens: { ...MILLION, input: 250_000 } }),
      ],
      DEFAULT_PRICING,
      10,
    );

    const text = formatCostReport(report);

    expect(text).toContain('run-1');
    expect(text).toContain('API-equivalent');
    expect(text).toMatch(/acme-fr\s+\$4\.00/);
    expect(text).toMatch(/outreach-researcher\s+1 call/);
    expect(text).toMatch(/orchestrator/);
    expect(text).toMatch(/Run total\s+\$5\.00/);
    expect(text).toMatch(/Average per company \(with overhead\)\s+\$5\.00/);
    expect(text).toMatch(/Average per company \(without overhead\)\s+\$4\.00/);
    expect(text).toContain('budget $10.00');
  });

  it('says so when a run has no recorded usage', () => {
    expect(formatCostReport(buildCostReport('run-9', [], DEFAULT_PRICING))).toContain('No usage recorded');
  });
});

describe('usage files', () => {
  function runsDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'usage-report-'));
    mkdirSync(join(dir, 'run-1'), { recursive: true });
    mkdirSync(join(dir, 'run-2'), { recursive: true });
    mkdirSync(join(dir, 'run-3'), { recursive: true });
    writeFileSync(
      join(dir, 'run-1', 'usage.jsonl'),
      [
        JSON.stringify(line({ key: 'a1', agent_type: 'outreach-researcher', slug: 'acme-fr', tokens: MILLION })),
        'not json',
        JSON.stringify({ ts: 'x', model: 'm' }),
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'run-2', 'usage.jsonl'),
      `${JSON.stringify(line({ key: 'a2', agent_type: 'outreach-writer', slug: 'b-de', tokens: MILLION }))}\n`,
    );
    return dir;
  }

  it('reads the valid lines and skips damaged ones', async () => {
    const result = await readUsageLines(join(runsDir(), 'run-1', 'usage.jsonl'));

    expect(result.lines).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it('treats a run without a usage file as empty', async () => {
    expect(await readUsageLines(join(runsDir(), 'run-3', 'usage.jsonl'))).toEqual({ lines: [], skipped: 0 });
  });

  it('lists the runs that have usage and summarizes them with a grand total', async () => {
    const dir = runsDir();

    expect(await listRunIds(dir)).toEqual(['run-1', 'run-2']);
    const summaries = await summarizeRuns(dir, DEFAULT_PRICING);
    expect(summaries.runs.map((run) => [run.runId, run.totalUsd, run.companyCount])).toEqual([
      ['run-1', 4, 1],
      ['run-2', 4, 1],
    ]);
    expect(summaries.grandTotalUsd).toBe(8);
    expect(formatRunSummaries(summaries)).toMatch(/All runs\s+\$8\.00/);
  });
});

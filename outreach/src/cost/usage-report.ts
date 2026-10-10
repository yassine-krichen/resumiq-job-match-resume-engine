import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { addTokens, costUsd, emptyTokens, rateFor } from './pricing';
import type { Pricing, TokenCounts } from './pricing';

// Turns runs/<run>/usage.jsonl (appended by .claude/hooks/record-usage.mjs) into the cost report of
// `npm run outreach -- cost`. Pure apart from reading the files.

const TokensSchema = z.object({
  input: z.number().int().min(0),
  output: z.number().int().min(0),
  cache_write: z.number().int().min(0),
  cache_read: z.number().int().min(0),
});

export const UsageLineSchema = z.object({
  ts: z.string().min(1),
  /** One agent invocation (the subagent's id, or the orchestrator's session id). A Stop hook rewrites running totals under the same key. */
  key: z.string().min(1).optional(),
  agent_type: z.string().min(1),
  slug: z.string().min(1).nullable(),
  model: z.string().min(1),
  tokens: TokensSchema,
});

export type UsageLine = z.infer<typeof UsageLineSchema>;

export const USAGE_FILE = 'usage.jsonl';

export async function readUsageLines(file: string): Promise<{ lines: UsageLine[]; skipped: number }> {
  let text: string;
  try {
    text = await readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lines: [], skipped: 0 };
    throw error;
  }
  const lines: UsageLine[] = [];
  let skipped = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      const parsed = UsageLineSchema.safeParse(JSON.parse(raw));
      if (parsed.success) lines.push(parsed.data);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { lines, skipped };
}

/** The last line written for each invocation and model: the hook appends running totals, never deltas. */
export function latestPerInvocation(lines: readonly UsageLine[]): UsageLine[] {
  const latest = new Map<string, UsageLine>();
  for (const line of lines) {
    const key = line.key ?? `${line.agent_type}|${line.slug ?? ''}|${line.ts}`;
    latest.set(`${key}\u0000${line.model}`, line);
  }
  return [...latest.values()];
}

export interface AgentCost {
  agentType: string;
  invocations: number;
  models: string[];
  tokens: TokenCounts;
  usd: number;
}

export interface CostGroup {
  agents: AgentCost[];
  tokens: TokenCounts;
  usd: number;
}

export interface CompanyCost extends CostGroup {
  slug: string;
}

export interface CostReport {
  runId: string;
  companies: CompanyCost[];
  /** Everything without a company: the orchestrator and the sourcer. */
  overhead: CostGroup;
  companyCount: number;
  totalUsd: number;
  totalTokens: TokenCounts;
  averagePerCompanyUsd: number | null;
  averagePerCompanyExcludingOverheadUsd: number | null;
  budgetUsd: number | null;
  overBudget: boolean;
  /** Models with no entry in the pricing section: their tokens are counted, their USD is not. */
  unpricedModels: string[];
}

function groupOf(lines: readonly UsageLine[], pricing: Pricing, unpriced: Set<string>): CostGroup {
  const byAgent = new Map<string, { keys: Set<string>; models: Set<string>; tokens: TokenCounts; usd: number }>();
  for (const line of lines) {
    const agent = byAgent.get(line.agent_type) ?? { keys: new Set(), models: new Set(), tokens: emptyTokens(), usd: 0 };
    agent.keys.add(line.key ?? `${line.ts}`);
    agent.models.add(line.model);
    agent.tokens = addTokens(agent.tokens, line.tokens);
    const rate = rateFor(line.model, pricing);
    if (rate) agent.usd += costUsd(line.tokens, rate);
    else unpriced.add(line.model);
    byAgent.set(line.agent_type, agent);
  }
  const agents: AgentCost[] = [...byAgent].map(([agentType, agent]) => ({
    agentType,
    invocations: agent.keys.size,
    models: [...agent.models].sort(),
    tokens: agent.tokens,
    usd: agent.usd,
  }));
  return {
    agents,
    tokens: agents.reduce((sum, agent) => addTokens(sum, agent.tokens), emptyTokens()),
    usd: agents.reduce((sum, agent) => sum + agent.usd, 0),
  };
}

export function buildCostReport(runId: string, lines: readonly UsageLine[], pricing: Pricing, budgetUsd?: number): CostReport {
  const unpriced = new Set<string>();
  const current = latestPerInvocation(lines);
  const bySlug = new Map<string, UsageLine[]>();
  const overheadLines: UsageLine[] = [];
  for (const line of current) {
    if (line.slug === null) overheadLines.push(line);
    else bySlug.set(line.slug, [...(bySlug.get(line.slug) ?? []), line]);
  }

  const companies: CompanyCost[] = [...bySlug].map(([slug, slugLines]) => ({ slug, ...groupOf(slugLines, pricing, unpriced) }));
  const overhead = groupOf(overheadLines, pricing, unpriced);
  const companiesUsd = companies.reduce((sum, company) => sum + company.usd, 0);
  const totalUsd = companiesUsd + overhead.usd;
  const companyCount = companies.length;

  return {
    runId,
    companies,
    overhead,
    companyCount,
    totalUsd,
    totalTokens: companies.reduce((sum, company) => addTokens(sum, company.tokens), overhead.tokens),
    averagePerCompanyUsd: companyCount > 0 ? totalUsd / companyCount : null,
    averagePerCompanyExcludingOverheadUsd: companyCount > 0 ? companiesUsd / companyCount : null,
    budgetUsd: budgetUsd ?? null,
    overBudget: budgetUsd !== undefined && totalUsd > budgetUsd,
    unpricedModels: [...unpriced].sort(),
  };
}

// ── Text output ─────────────────────────────────────────────────────────────

const NAME_WIDTH = 30;

function usd(value: number): string {
  return `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`;
}

function number(value: number): string {
  return value.toLocaleString('en-US');
}

function agentRow(agent: AgentCost): string {
  const calls = `${agent.invocations} ${agent.invocations === 1 ? 'call' : 'calls'}`;
  return [
    `  ${agent.agentType}`.padEnd(NAME_WIDTH),
    calls.padEnd(9),
    number(agent.tokens.input).padStart(12),
    number(agent.tokens.output).padStart(11),
    number(agent.tokens.cache_write).padStart(12),
    number(agent.tokens.cache_read).padStart(14),
    usd(agent.usd).padStart(10),
  ].join(' ');
}

function groupRows(title: string, group: CostGroup): string[] {
  return [`${title.padEnd(NAME_WIDTH)} ${' '.repeat(9 + 12 + 11 + 12 + 14 + 5)} ${usd(group.usd).padStart(10)}`, ...group.agents.map(agentRow)];
}

function summaryRow(label: string, value: string): string {
  return `${label.padEnd(NAME_WIDTH + 18)}${value.padStart(10)}`;
}

export function formatCostReport(report: CostReport): string {
  if (report.companies.length === 0 && report.overhead.agents.length === 0) {
    return `No usage recorded for ${report.runId} (runs/${report.runId}/${USAGE_FILE}). The usage hook writes it as agents finish.`;
  }
  const header = [
    'company / agent'.padEnd(NAME_WIDTH),
    'calls'.padEnd(9),
    'input'.padStart(12),
    'output'.padStart(11),
    'cache write'.padStart(12),
    'cache read'.padStart(14),
    'USD'.padStart(10),
  ].join(' ');

  const out = [
    `Cost of ${report.runId}: API-equivalent USD at list prices. On a Claude subscription this measures quota use, not a bill.`,
    '',
    header,
    ...report.companies.flatMap((company) => groupRows(company.slug, company)),
    ...(report.overhead.agents.length > 0 ? groupRows('Orchestrator and run overhead', report.overhead) : []),
    '',
    summaryRow('Run total', usd(report.totalUsd)),
  ];
  if (report.averagePerCompanyUsd !== null && report.averagePerCompanyExcludingOverheadUsd !== null) {
    out.push(
      summaryRow('Average per company (with overhead)', usd(report.averagePerCompanyUsd)),
      summaryRow('Average per company (without overhead)', usd(report.averagePerCompanyExcludingOverheadUsd)),
    );
  }
  if (report.budgetUsd !== null) {
    out.push(`${report.overBudget ? 'OVER' : 'Within'} run budget ${usd(report.budgetUsd)}`);
  }
  if (report.unpricedModels.length > 0) {
    out.push(
      `Unpriced models (tokens counted, USD not): ${report.unpricedModels.join(', ')}. Add them to "pricing" in outreach.config.json.`,
    );
  }
  return out.join('\n');
}

// ── All runs ────────────────────────────────────────────────────────────────

export interface RunSummary {
  runId: string;
  companyCount: number;
  totalUsd: number;
  averagePerCompanyUsd: number | null;
}

export interface RunSummaries {
  runs: RunSummary[];
  grandTotalUsd: number;
}

/** Run folders that have a usage file, oldest name first. */
export async function listRunIds(runsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((entry) => existsSync(join(runsDir, entry, USAGE_FILE))).sort();
}

export async function summarizeRuns(runsDir: string, pricing: Pricing): Promise<RunSummaries> {
  const runs: RunSummary[] = [];
  for (const runId of await listRunIds(runsDir)) {
    const { lines } = await readUsageLines(join(runsDir, runId, USAGE_FILE));
    const report = buildCostReport(runId, lines, pricing);
    runs.push({
      runId,
      companyCount: report.companyCount,
      totalUsd: report.totalUsd,
      averagePerCompanyUsd: report.averagePerCompanyUsd,
    });
  }
  return { runs, grandTotalUsd: runs.reduce((sum, run) => sum + run.totalUsd, 0) };
}

export function formatRunSummaries(summaries: RunSummaries): string {
  if (summaries.runs.length === 0) return 'No usage recorded in any run yet.';
  const rows = summaries.runs.map(
    (run) =>
      `${run.runId.padEnd(NAME_WIDTH)} ${String(run.companyCount).padStart(9)} companies ${usd(run.totalUsd).padStart(10)} ${
        run.averagePerCompanyUsd === null ? '' : `(${usd(run.averagePerCompanyUsd)} per company)`
      }`.trimEnd(),
  );
  return [
    'API-equivalent USD at list prices. On a Claude subscription this measures quota use, not a bill.',
    '',
    ...rows,
    '',
    summaryRow('All runs', usd(summaries.grandTotalUsd)),
  ].join('\n');
}

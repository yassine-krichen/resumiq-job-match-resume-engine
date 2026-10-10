import { join } from 'node:path';

import { loadAppConfig } from '../config/app-config';
import { USAGE_FILE, buildCostReport, formatCostReport, formatRunSummaries, readUsageLines, summarizeRuns } from '../cost/usage-report';
import { RunLayout } from '../services/run-layout';

import type { Context } from './context';

// `cost --run <id> [--json]` and `cost --all [--json]`: what the agents of a run used, in API-equivalent USD.
// Reads only runs/<run>/usage.jsonl and the pricing in the config: no database, no network.

export async function costCommand(context: Context, options: { runId?: string; all: boolean; json: boolean }): Promise<string> {
  const config = loadAppConfig(context.env.configPath, context.paths.root);

  if (options.all) {
    const summaries = await summarizeRuns(context.paths.runsDir, config.pricing);
    return options.json ? JSON.stringify(summaries, null, 2) : formatRunSummaries(summaries);
  }

  const layout = new RunLayout(context.paths, options.runId ?? '');
  const { lines, skipped } = await readUsageLines(join(layout.runDir, USAGE_FILE));
  if (skipped > 0) console.error(`warning: ${skipped} unreadable line(s) in runs/${layout.runId}/${USAGE_FILE} were skipped`);
  const report = buildCostReport(layout.runId, lines, config.pricing, config.runBudgetUsd);
  return options.json ? JSON.stringify(report, null, 2) : formatCostReport(report);
}

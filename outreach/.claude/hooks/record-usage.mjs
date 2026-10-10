// SubagentStop and Stop hook: appends the token usage of the agent that just finished to runs/<run>/usage.jsonl
// (logic in usage.cjs). It must never get in the way of the pipeline: whatever happens it prints nothing and
// exits 0, and a problem is written to logs/hooks.log instead.
import { appendFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { recordUsage } = createRequire(import.meta.url)('./usage.cjs');

// OUTREACH_HOOK_ROOT exists for the unit tests; Claude Code never sets it.
const root = process.env.OUTREACH_HOOK_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function logProblem(message) {
  try {
    const logs = join(root, 'logs');
    mkdirSync(logs, { recursive: true });
    const text = String(message).replace(/\s+/g, ' ').slice(0, 300);
    appendFileSync(join(logs, 'hooks.log'), `${new Date().toISOString()} record-usage: ${text}\n`, 'utf8');
  } catch {
    // Nowhere left to report to.
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      logProblem('unreadable hook input');
      return;
    }
    if (payload === null || typeof payload !== 'object') {
      logProblem('unreadable hook input');
      return;
    }
    const { skipped } = recordUsage(payload, { root });
    // A Stop in an ordinary session is expected to be skipped; a subagent whose usage went nowhere is worth a line.
    if (skipped && payload.hook_event_name === 'SubagentStop') logProblem(`subagent usage not recorded: ${skipped}`);
  } catch (error) {
    logProblem(error instanceof Error ? error.message : error);
  }
});

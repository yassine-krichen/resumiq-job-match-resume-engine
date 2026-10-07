// PreToolUse hook for the Bash and PowerShell tools: refuses PowerShell outright and, for Bash, everything
// except the outreach CLI (decision logic in decide.cjs). Reads the hook payload on stdin and, for
// a refused command, prints a deny decision. Allowed commands print nothing and
// fall through to the normal permission rules in settings.json.
import { createRequire } from 'node:module';

const { decideTool } = createRequire(import.meta.url)('./decide.cjs');

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked by .claude/hooks/guard-bash.mjs: ${reason}`,
      },
    })}\n`,
  );
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    // Unreadable payload: fail closed.
    return deny('unreadable hook input');
  }
  const decision = decideTool(payload?.tool_name, payload?.tool_input?.command);
  if (!decision.allow) deny(decision.reason);
});

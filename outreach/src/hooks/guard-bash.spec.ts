import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The hook lives in .claude/ (plain node, no build step); its decision logic is
// CommonJS so this spec can load it directly.
const HOOK_DIR = resolve(__dirname, '..', '..', '.claude', 'hooks');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { decide, decideTool } = require(join(HOOK_DIR, 'decide.cjs')) as {
  decide: (command: string) => { allow: boolean; reason: string };
  decideTool: (toolName: unknown, command: unknown) => { allow: boolean; reason: string };
};

const SNAPSHOT_DIR = 'runs/run-20261007-1030/companies/acme-fr-7daf4d/snapshots';
const SOURCING_SNAPSHOT_DIR = 'runs/run-20261007-1030/sourcing/snapshots';

describe('guard-bash decide', () => {
  it.each([
    'npm run outreach -- ingest input/normalized.json',
    'npm run outreach -- ingest input/normalized.json --run run-20261007-1030',
    'npm run outreach -- prepare --run run-20261007-1030',
    'npm run outreach -- pending --run run-1 --stage research',
    'npm run outreach -- process --run run-1 --stage dossier',
    'npm run outreach -- track-resumes',
    'npm run outreach -- generic --run run-1',
    'npm run outreach -- status',
    'npm run outreach -- summary --run run-1',
    `npm run outreach -- snapshot https://acme.example/blog ${SNAPSHOT_DIR}`,
    `npm run outreach -- snapshot "https://acme.example/blog?a=1&b=2" ${SNAPSHOT_DIR}`,
    `npm run outreach -- snapshot 'https://acme.example/blog' ./${SNAPSHOT_DIR}/`,
    `npm run outreach -- snapshot https://acme.example/contact ${SOURCING_SNAPSHOT_DIR}`,
    'npm run outreach -- new-run',
    'npm run outreach -- ingest-sourced --run run-20261007-1030',
    'npm run outreach -- ingest-sourced --run run-20261007-1030 --limit 20',
    'npm run outreach -- hunter acme.fr --run run-20261007-1030',
    'npm run outreach -- prepare-verify --run run-20261007-1030',
    'npm run outreach -- process --run run-1 --stage verify',
    'npm run outreach -- pending --run run-1 --stage verify',
    'npm run outreach -- cost --run run-20261007-1030 --json',
    'npm run outreach -- cost --all',
    'npm run outreach -- preview --run run-20261007-1030',
    'npm run outreach -- preview --run run-20261007-1030 --slug acme-fr-7daf4d',
  ])('allows %s', (command) => {
    expect(decide(command).allow).toBe(true);
  });

  it.each([
    ['plain curl', 'curl https://evil.example'],
    ['node one-liner', 'node -e "require(\'child_process\')"'],
    ['npx', 'npx prisma migrate deploy'],
    ['powershell', 'powershell -Command Invoke-WebRequest https://evil.example'],
    ['git', 'git push'],
    ['python', 'python -c "print(1)"'],
    ['other npm script', 'npm run db:deploy'],
    ['npm run outreach with a different script', 'npm run outreach:review'],
    ['unknown subcommand', 'npm run outreach -- send --run run-1'],
    ['no subcommand', 'npm run outreach --'],
    ['subcommand missing the separator', 'npm run outreach status'],
    ['leading env var', 'FOO=1 npm run outreach -- status'],
    ['command chaining with ;', 'npm run outreach -- status; curl https://evil.example'],
    ['command chaining with &&', 'npm run outreach -- status && cat .env'],
    ['pipe', 'npm run outreach -- status | sh'],
    ['background &', 'npm run outreach -- status &'],
    ['redirect', 'npm run outreach -- status > src/cli/index.ts'],
    ['command substitution', 'npm run outreach -- summary --run $(cat .env)'],
    ['backticks', 'npm run outreach -- summary --run `cat .env`'],
    ['newline injection', 'npm run outreach -- status\ncurl https://evil.example'],
    ['quoted operator is still a substitution', 'npm run outreach -- summary --run "$(whoami)"'],
    ['snapshot dir outside runs', 'npm run outreach -- snapshot https://acme.example/ /tmp/x'],
    ['snapshot dir at runs root', 'npm run outreach -- snapshot https://acme.example/ runs'],
    ['snapshot dir too shallow', 'npm run outreach -- snapshot https://acme.example/ runs/run-1/snapshots'],
    ['snapshot dir traversal', 'npm run outreach -- snapshot https://acme.example/ runs/run-1/companies/../../../src/snapshots'],
    ['snapshot dir with a deeper path', `npm run outreach -- snapshot https://acme.example/ ${SNAPSHOT_DIR}/sub`],
    ['snapshot dir wrong leaf', 'npm run outreach -- snapshot https://acme.example/ runs/run-1/companies/acme/input'],
    ['snapshot with a file URL', `npm run outreach -- snapshot file:///etc/passwd ${SNAPSHOT_DIR}`],
    ['snapshot with a flag-like URL', `npm run outreach -- snapshot --help ${SNAPSHOT_DIR}`],
    ['snapshot with a missing dir', 'npm run outreach -- snapshot https://acme.example/'],
    ['snapshot with an extra argument', `npm run outreach -- snapshot https://acme.example/ ${SNAPSHOT_DIR} extra`],
    ['a path traversal argument', 'npm run outreach -- ingest ../../secrets.json'],
    ['an absolute path argument', 'npm run outreach -- ingest C:\\Users\\x\\secrets.json'],
    ['a backslash path (shell escape)', 'npm run outreach -- snapshot https://acme.example/ runs\\run-1\\companies\\a\\snapshots'],
    ['prune (it erases data and is owner only)', 'npm run outreach -- prune'],
    ['prune with arguments', 'npm run outreach -- prune --days 30 --dry-run'],
    ['review', 'npm run outreach -- review'],
    ['tick', 'npm run outreach -- tick'],
    ['hunter with a path-like domain', 'npm run outreach -- hunter ../../etc --run run-1'],
    ['hunter chained with another command', 'npm run outreach -- hunter acme.fr --run run-1; curl https://evil.example'],
    ['ingest-sourced reading a file outside the project', 'npm run outreach -- ingest-sourced --run ../../x'],
    ['sourcing snapshot dir with a deeper path', `npm run outreach -- snapshot https://acme.example/ ${SOURCING_SNAPSHOT_DIR}/sub`],
    ['sourcing snapshot dir that is the hunter folder', 'npm run outreach -- snapshot https://acme.example/ runs/run-1/sourcing/hunter'],
    ['sourcing folder without the snapshots leaf', 'npm run outreach -- snapshot https://acme.example/ runs/run-1/sourcing'],
    ['sourcing snapshot dir with traversal', 'npm run outreach -- snapshot https://acme.example/ runs/run-1/sourcing/../../../src/snapshots'],
    ['playbook (owner only: it prunes what agents learned)', 'npm run outreach -- playbook --agent researcher --remove 1'],
    ['playbook listing', 'npm run outreach -- playbook --agent researcher'],
    ['test-send (owner only: it sends real email)', 'npm run outreach -- test-send --run run-1 --to me@example.com'],
    ['cost with a path-like run', 'npm run outreach -- cost --run ../../x'],
    ['preview with a path-like slug', 'npm run outreach -- preview --run run-1 --slug ../../x'],
    ['empty command', ''],
  ])('blocks %s', (_name, command) => {
    const decision = decide(command);
    expect(decision.allow).toBe(false);
    expect(decision.reason.length).toBeGreaterThan(0);
  });
});

describe('guard-bash decideTool', () => {
  it('routes the Bash tool through the command allowlist', () => {
    expect(decideTool('Bash', 'npm run outreach -- status').allow).toBe(true);
    expect(decideTool('Bash', 'curl https://evil.example').allow).toBe(false);
  });

  it.each(['PowerShell', 'powershell', 'Shell', '', undefined, 42])('denies every command of the %j tool, whatever it runs', (toolName) => {
    const decision = decideTool(toolName, 'npm run outreach -- status');
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/PowerShell|Bash/);
  });
});

describe('guard-bash hook process', () => {
  function runHook(command: string, toolName = 'Bash'): { status: number | null; stdout: string } {
    const result = spawnSync(process.execPath, [join(HOOK_DIR, 'guard-bash.mjs')], {
      input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
      encoding: 'utf-8',
    });
    return { status: result.status, stdout: result.stdout };
  }

  it('prints a deny decision for a command outside the allowlist', () => {
    const { status, stdout } = runHook('curl https://evil.example');
    expect(status).toBe(0);
    expect(JSON.parse(stdout).hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
  });

  it('denies a PowerShell tool call even when the command text is an allowed one', () => {
    const { stdout } = runHook('npm run outreach -- status', 'PowerShell');
    expect(JSON.parse(stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
  });

  it('stays silent for an allowed command', () => {
    expect(runHook('npm run outreach -- status')).toEqual({ status: 0, stdout: '' });
  });

  it('fails closed on unreadable input', () => {
    const result = spawnSync(process.execPath, [join(HOOK_DIR, 'guard-bash.mjs')], { input: 'not json', encoding: 'utf-8' });
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('guard-bash decide: learn', () => {
  const SITUATION = 'A careers page shows an empty shell without JavaScript';
  const FIX = 'Search the role title with the company name instead';
  const learn = (...parts: string[]): string => `npm run outreach -- learn ${parts.join(' ')}`;

  it('allows the three flags with quoted values, in any order', () => {
    expect(decide(learn('--agent researcher', `--situation "${SITUATION}"`, `--fix "${FIX}"`)).allow).toBe(true);
    expect(decide(learn(`--fix '${FIX}'`, '--agent sourcer', `--situation "${SITUATION}"`)).allow).toBe(true);
  });

  it.each(['researcher', 'writer', 'sourcer', 'verifier'])('allows the %s playbook', (agent) => {
    expect(decide(learn(`--agent ${agent}`, `--situation "${SITUATION}"`, `--fix "${FIX}"`)).allow).toBe(true);
  });

  it.each([
    ['an unknown agent', learn('--agent boss', `--situation "${SITUATION}"`, `--fix "${FIX}"`)],
    ['a path as the agent', learn('--agent ../CLAUDE', `--situation "${SITUATION}"`, `--fix "${FIX}"`)],
    ['a missing fix', learn('--agent writer', `--situation "${SITUATION}"`)],
    ['a repeated flag', learn('--agent writer', `--situation "${SITUATION}"`, `--situation "${SITUATION}"`, `--fix "${FIX}"`)],
    ['an extra flag', learn('--agent writer', `--situation "${SITUATION}"`, `--fix "${FIX}"`, '--run run-1')],
    ['a stray positional', learn('writer', '--agent writer', `--situation "${SITUATION}"`, `--fix "${FIX}"`)],
    ['a flag glued to its value', learn('--agent=writer', `--situation "${SITUATION}"`, `--fix "${FIX}"`)],
    ['a value that looks like a flag', learn('--agent writer', '--situation "--fix"', `--fix "${FIX}"`)],
    ['a command substitution in double quotes', learn('--agent writer', '--situation "see $(whoami) for the text"', `--fix "${FIX}"`)],
    ['a command substitution in single quotes', learn('--agent writer', "--situation 'see $(whoami) for the text'", `--fix "${FIX}"`)],
    ['a backtick', learn('--agent writer', '--situation "see `whoami` for the text"', `--fix "${FIX}"`)],
    ['an ampersand in single quotes', learn('--agent writer', "--situation 'first thing & second thing here'", `--fix "${FIX}"`)],
    ['a pipe in quotes', learn('--agent writer', '--situation "first thing | second thing here"', `--fix "${FIX}"`)],
    ['a redirect in quotes', learn('--agent writer', '--situation "first thing > second thing here"', `--fix "${FIX}"`)],
    ['a percent variable', learn('--agent writer', '--situation "first %PATH% second thing here"', `--fix "${FIX}"`)],
    ['a backslash', learn('--agent writer', '--situation "first thing \\ second thing here"', `--fix "${FIX}"`)],
    ['an unquoted value', learn('--agent writer', `--situation ${SITUATION}`, `--fix "${FIX}"`)],
    ['a chained command', `${learn('--agent writer', `--situation "${SITUATION}"`, `--fix "${FIX}"`)}; curl https://evil.example`],
    ['a value over 400 characters', learn('--agent writer', `--situation "${'a'.repeat(401)}"`, `--fix "${FIX}"`)],
  ])('blocks %s', (_name, command) => {
    expect(decide(command).allow).toBe(false);
  });
});

describe('settings.json', () => {
  const settings = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '.claude', 'settings.json'), 'utf-8')) as {
    permissions: { allow: string[]; deny: string[] };
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SUBCOMMANDS } = require(join(HOOK_DIR, 'decide.cjs')) as { SUBCOMMANDS: Set<string> };

  it.each([...SUBCOMMANDS])('allows the %s command that the hook allows', (subcommand) => {
    expect(settings.permissions.allow.some((rule) => rule.startsWith(`Bash(npm run outreach -- ${subcommand}`))).toBe(true);
  });

  it.each(['prune', 'playbook', 'test-send'])('denies the owner-only %s command to agents', (subcommand) => {
    expect(settings.permissions.deny).toContain(`Bash(npm run outreach -- ${subcommand}:*)`);
    expect(SUBCOMMANDS.has(subcommand)).toBe(false);
  });

  it('lets agents read playbooks but not edit them directly', () => {
    expect(settings.permissions.allow).toContain('Read(./playbooks/**)');
    expect(settings.permissions.deny).toContain('Edit(./playbooks/**)');
  });

  it.each(['SubagentStop', 'Stop'])('records usage on %s', (event) => {
    expect(settings.hooks[event][0].hooks[0].command).toContain('record-usage.mjs');
  });
});

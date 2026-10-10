'use strict';

// Decision logic of the Bash guard (see guard-bash.mjs). Kept as plain
// CommonJS with no dependencies so the hook runs without a build step and the
// unit tests can load it.
//
// Only one kind of shell command is ever needed in this project:
//   npm run outreach -- <subcommand> <args>
// Everything else (curl, node, git, python, shell chaining, redirects,
// substitutions) is refused, whatever a web page or a list tells the agent.

const SUBCOMMANDS = new Set([
  'ingest',
  'prepare',
  'snapshot',
  'process',
  'pending',
  'track-resumes',
  'generic',
  'status',
  'summary',
  'new-run',
  'ingest-sourced',
  'hunter',
  'prepare-verify',
  'cost',
  'preview',
  'learn',
]);
// Deliberately absent (owner only): prune (erases data), review, auth, signature, tick, test-send (sends real
// email), playbook (lists and deletes what agents learned).

// runs/<runId>/companies/<slug>/snapshots, nothing deeper, nothing else.
// runs/<runId>/sourcing/snapshots is where the sourcer saves the pages it quotes addresses from.
const SNAPSHOT_DIR =
  /^runs\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/(?:companies\/[a-z0-9][a-z0-9-]{0,79}|sourcing)\/snapshots$/;
const PLAIN_ARGUMENT = /^[A-Za-z0-9._\/=-]+$/;
const PLAYBOOK_AGENTS = new Set(['researcher', 'writer', 'sourcer', 'verifier']);
// The text of a playbook entry crosses npm and, on Windows, cmd.exe: only characters that mean nothing to either.
// (No quotes, $, backtick, backslash, %, &, |, <, >, ^, ;, braces or brackets.) The CLI validates the content itself.
const LEARN_TEXT = /^[\p{L}\p{N} .,:'()\-_/+=?]{1,400}$/u;

function deny(reason) {
  return { allow: false, reason };
}

/** Splits a command into tokens, refusing every shell construct that could run something else. */
function tokenize(command) {
  const tokens = [];
  let current = '';
  let started = false;
  let quote = null;

  for (const char of command) {
    if (quote === "'") {
      if (char === "'") quote = null;
      else if (char === '\n' || char === '\r') return { error: 'line breaks are not allowed' };
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if ('$`\!\n\r'.includes(char)) return { error: `"${char === '\n' ? '\n' : char}" is not allowed inside quotes` };
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    if (';&|<>()\n\r`$\*?[]{}~!#'.includes(char)) {
      return { error: `shell syntax "${char === '\n' ? '\n' : char}" is not allowed` };
    }
    current += char;
    started = true;
  }
  if (quote !== null) return { error: 'unterminated quote' };
  if (started) tokens.push(current);
  return { tokens };
}

function hasParentSegment(value) {
  return value.split('/').includes('..');
}

function checkSnapshot(args) {
  if (args.length !== 2) return deny('snapshot takes exactly a URL and a folder');
  const [url, dir] = args;
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return deny('snapshot only fetches http(s) URLs');
  const normalized = dir.replace(/^\.\//, '').replace(/\/+$/, '');
  if (hasParentSegment(normalized) || !SNAPSHOT_DIR.test(normalized)) {
    return deny('snapshot folder must be runs/<run>/companies/<slug>/snapshots');
  }
  return { allow: true, reason: 'snapshot into the company folder' };
}

/** learn --agent <name> --situation "<text>" --fix "<text>": exactly these three flags, once each, any order. */
function checkLearn(args) {
  const seen = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--agent', '--situation', '--fix'].includes(flag) || seen.has(flag) || value === undefined) {
      return deny('learn takes --agent <name> --situation "<text>" --fix "<text>", each once');
    }
    seen.set(flag, value);
  }
  if (seen.size !== 3) return deny('learn needs --agent, --situation and --fix');
  if (!PLAYBOOK_AGENTS.has(seen.get('--agent'))) return deny('learn --agent must be researcher, writer, sourcer or verifier');
  for (const flag of ['--situation', '--fix']) {
    const value = seen.get(flag);
    if (value.startsWith('-') || !LEARN_TEXT.test(value)) {
      return deny(`learn ${flag} may only contain letters, digits, spaces and . , : ' ( ) - _ / + = ?`);
    }
  }
  return { allow: true, reason: 'record a playbook entry (the CLI validates it)' };
}

function checkOtherArguments(args) {
  for (const arg of args) {
    if (!PLAIN_ARGUMENT.test(arg)) return deny(`argument "${arg}" is not allowed`);
    if (arg.startsWith('/') || hasParentSegment(arg)) return deny(`path "${arg}" must stay inside the project`);
  }
  return { allow: true, reason: 'allowed outreach command' };
}

/**
 * @param {string} command the Bash command the agent wants to run
 * @returns {{ allow: boolean, reason: string }}
 */
function decide(command) {
  if (typeof command !== 'string' || command.trim() === '') return deny('empty command');
  const parsed = tokenize(command.trim());
  if (parsed.error) return deny(parsed.error);

  const [npm, run, script, separator, subcommand, ...args] = parsed.tokens;
  if (npm !== 'npm' || run !== 'run' || script !== 'outreach' || separator !== '--') {
    return deny('only "npm run outreach -- <subcommand>" may be run');
  }
  if (!SUBCOMMANDS.has(subcommand)) return deny(`unknown outreach subcommand "${subcommand ?? ''}"`);
  if (subcommand === 'snapshot') return checkSnapshot(args);
  if (subcommand === 'learn') return checkLearn(args);
  return checkOtherArguments(args);
}

/**
 * The hook is registered for Bash and PowerShell. PowerShell runs anything (Invoke-WebRequest, file writes), so it
 * is never allowed for agents; Bash goes through the command allowlist.
 * @param {unknown} toolName `tool_name` of the hook payload
 * @param {unknown} command `tool_input.command` of the hook payload
 * @returns {{ allow: boolean, reason: string }}
 */
function decideTool(toolName, command) {
  if (toolName === 'Bash') return decide(command);
  return deny('only the Bash tool may run commands here (PowerShell is not available to agents)');
}

module.exports = { decide, decideTool, SUBCOMMANDS };

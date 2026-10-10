// Gatekeeper for `learn`. A playbook entry is read by a later agent as a hint, so a hostile web page that makes
// an agent record "a learning" would be persisting a prompt injection across runs. Everything that could carry an
// instruction, a command, a link to follow or an address to contact is therefore refused here, in code, not by
// asking the agent to be careful.

export const MIN_FIELD_LENGTH = 15;
export const MAX_FIELD_LENGTH = 300;
/** Two entries whose words overlap at least this much are one lesson seen twice. */
export const DUPLICATE_SIMILARITY = 0.8;

export type LearningCheck = { ok: true; situation: string; fix: string } | { ok: false; errors: string[] };

// eslint-disable-next-line no-control-regex
const NOT_SINGLE_LINE = new RegExp('[\u0000-\u001f\u007f\u2028\u2029]');
const PROGRAM_NAME = /\b(?:npm|npx|node|curl|wget|powershell|pwsh|python3?|git|bash|cmd)\b/i;
const EMAIL_ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const FOREIGN_SCHEME = /\b(?!https?:)[a-z][a-z0-9+.-]*:\/\//i;
// A host name, optionally with a scheme and port; group 1 is whatever follows it (a path, query or fragment).
const HOST_WITH_TAIL = /(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?([/?#]\S*)?/gi;
const OVERRIDE_PHRASE =
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.]{0,60}\b(?:previous|prior|above|earlier|instructions?|rules?|permissions?|guidelines)\b/i;
const PROMPT_REFERENCE = /\bsystem prompt\b|claude\.md/i;

function hasUrlWithTail(text: string): boolean {
  for (const match of text.matchAll(HOST_WITH_TAIL)) {
    const tail = match[1];
    if (tail !== undefined && tail !== '/') return true;
  }
  return false;
}

function problemsOf(name: string, value: unknown): string[] {
  if (typeof value !== 'string') return [`${name} must be text`];
  const text = value.trim();
  const problems: string[] = [];
  if (text.length < MIN_FIELD_LENGTH || text.length > MAX_FIELD_LENGTH) {
    problems.push(`${name} must be ${MIN_FIELD_LENGTH}-${MAX_FIELD_LENGTH} characters (it is ${text.length})`);
  }
  if (NOT_SINGLE_LINE.test(text)) problems.push(`${name} must be a single line of plain text`);
  if (text.includes('`')) problems.push(`${name} must not contain backticks`);
  if (text.includes('$(')) problems.push(`${name} must not contain a command substitution`);
  if (text.includes('${')) problems.push(`${name} must not contain a variable expansion`);
  if (PROGRAM_NAME.test(text)) problems.push(`${name} must not name a program or shell (npm, node, curl, wget, powershell, python, git, ...)`);
  if (FOREIGN_SCHEME.test(text) || hasUrlWithTail(text)) {
    problems.push(`${name} must not contain a URL with a path or query (a bare domain such as acme.example is fine)`);
  }
  if (EMAIL_ADDRESS.test(text)) problems.push(`${name} must not contain an email address`);
  if (OVERRIDE_PHRASE.test(text) || PROMPT_REFERENCE.test(text)) {
    problems.push(`${name} must not try to override instructions, rules or permissions, or mention CLAUDE.md or the system prompt`);
  }
  if (text.includes('=>')) problems.push(`${name} must not contain "=>" (it separates the two parts in the playbook file)`);
  return problems;
}

/** Checks both fields; on success returns them trimmed with single spaces. */
export function validateLearning(input: { situation: unknown; fix: unknown }): LearningCheck {
  const errors = [...problemsOf('situation', input.situation), ...problemsOf('fix', input.fix)];
  if (errors.length > 0) return { ok: false, errors };
  const squash = (value: unknown): string => String(value).trim().replace(/ {2,}/g, ' ');
  return { ok: true, situation: squash(input.situation), fix: squash(input.fix) };
}

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );
}

/** Share of distinct words (3+ letters, case and punctuation ignored) that two texts have in common, 0 to 1. */
export function similarity(a: string, b: string): number {
  const left = wordsOf(a);
  const right = wordsOf(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

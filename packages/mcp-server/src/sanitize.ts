import { homedir } from 'os';

const MIN_ENV_VALUE_LENGTH = 8;
const MAX_MESSAGE_LENGTH = 300;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Makes an error message safe to hand to the caller or write to stderr: strips
 * the home directory, any absolute path, secret-looking tokens and the value of
 * any environment variable. Messages are also length-capped, and callers should
 * never pass a stack trace in.
 */
export function sanitizeMessage(message: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = message;

  // Order matters: whole paths go before env values, otherwise an env value that is a
  // path prefix (TEMP, HOME) is cut out and leaves the rest of the path behind.
  for (const home of new Set([homedir(), homedir().replace(/\\/g, '/')])) {
    // Takes the rest of the path too: what sits under the home directory is private as well.
    if (home) out = out.replace(new RegExp(`${escapeRegExp(home)}[^\\s"'\`)]*`, 'gi'), '[path]');
  }

  out = out
    // Windows (C:\..., C:/...) and POSIX absolute paths
    .replace(/[A-Za-z]:[\\/][^\s"'`)]*/g, '[path]')
    .replace(/(^|[\s"'`(=])\/(?:[\w.-]+\/)+[\w.-]*/g, '$1[path]')
    // API-key-looking tokens
    .replace(/\b(?:sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');

  const secrets = Object.values(env)
    .filter((v): v is string => typeof v === 'string' && v.length >= MIN_ENV_VALUE_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) out = out.replace(new RegExp(escapeRegExp(secret), 'g'), '[redacted]');

  return out.length > MAX_MESSAGE_LENGTH ? `${out.slice(0, MAX_MESSAGE_LENGTH)}…` : out;
}

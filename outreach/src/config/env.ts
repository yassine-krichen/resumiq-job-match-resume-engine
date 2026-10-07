import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

// Env is validated when a command starts, not when production first needs a
// value. The DB url is only required by commands that touch the database, so
// `track-resumes` and `snapshot` run without one.

// A blank value (as copied from .env.example) means "not set".
const blankAsUnset = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const RuntimeEnvSchema = z.object({
  TECTONIC_PATH: z.preprocess(blankAsUnset, z.string().trim().min(1).default('tectonic')),
  OUTREACH_CONFIG_PATH: z.preprocess(blankAsUnset, z.string().trim().min(1).default('outreach.config.json')),
});

// `schema=` is mandatory: it is what keeps these tables (and their
// _prisma_migrations) out of the `public` schema of a shared database.
const DatabaseEnvSchema = z.object({
  OUTREACH_DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'is required')
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgres:// or postgresql:// URL')
    .refine((value) => {
      try {
        const schema = new URL(value).searchParams.get('schema');
        return schema !== null && /^[a-z_][a-z0-9_]*$/.test(schema) && schema !== 'public';
      } catch {
        return false;
      }
    }, 'must carry a dedicated schema, e.g. ?schema=outreach (never "public")'),
});

export interface RuntimeEnv {
  tectonicPath: string;
  configPath: string;
}

export class EnvError extends Error {}

function describe(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`).join('; ');
}

/** Throws EnvError with the offending variable names; never echoes a value (the DB url holds a password). */
export function loadRuntimeEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const parsed = RuntimeEnvSchema.safeParse(source);
  if (!parsed.success) throw new EnvError(`Invalid environment: ${describe(parsed.error)}`);
  return { tectonicPath: parsed.data.TECTONIC_PATH, configPath: parsed.data.OUTREACH_CONFIG_PATH };
}

/** The Postgres schema named by the already validated database URL (`?schema=outreach`). */
export function databaseSchemaOf(databaseUrl: string): string {
  const schema = new URL(databaseUrl).searchParams.get('schema');
  if (schema === null || !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new EnvError('Invalid environment: OUTREACH_DATABASE_URL has no valid schema');
  return schema;
}

export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const parsed = DatabaseEnvSchema.safeParse(source);
  if (!parsed.success) throw new EnvError(`Invalid environment: ${describe(parsed.error)}`);
  return parsed.data.OUTREACH_DATABASE_URL;
}

// The OAuth "Desktop app" client of your own Google Cloud project, and where the refresh token is kept.
// The token lives under the home folder, never in the repo: it is a mailbox credential.
const GmailEnvSchema = z.object({
  GMAIL_CLIENT_ID: z.string().trim().min(1, 'is required (OAuth desktop client id)'),
  GMAIL_CLIENT_SECRET: z.string().trim().min(1, 'is required (OAuth desktop client secret)'),
  GMAIL_TOKEN_PATH: z.preprocess(blankAsUnset, z.string().trim().min(1).optional()),
});

export interface GmailEnv {
  clientId: string;
  clientSecret: string;
  tokenPath: string;
}

export function defaultGmailTokenPath(): string {
  return join(homedir(), '.config', 'cold-outreach', 'gmail-token.json');
}

/** Only the commands that talk to Gmail need these, so a missing value fails there and not at startup. */
export function loadGmailEnv(source: NodeJS.ProcessEnv = process.env): GmailEnv {
  const parsed = GmailEnvSchema.safeParse(source);
  if (!parsed.success) throw new EnvError(`Invalid environment: ${describe(parsed.error)}`);
  return {
    clientId: parsed.data.GMAIL_CLIENT_ID,
    clientSecret: parsed.data.GMAIL_CLIENT_SECRET,
    tokenPath: parsed.data.GMAIL_TOKEN_PATH ?? defaultGmailTokenPath(),
  };
}

/** Optional: Hunter contact lookup is skipped when no key is set. Blank counts as unset. The value is never logged. */
export function loadHunterApiKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const key = source.HUNTER_API_KEY?.trim();
  return key ? key : null;
}

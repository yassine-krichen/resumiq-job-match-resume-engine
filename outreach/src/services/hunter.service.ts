import { z } from 'zod';

import { normalizeDomain } from '../core/normalize-input';

import { RunLayout, relativeToRoot, writeJsonAtomic } from './run-layout';

// Optional contact discovery (phase 3). Hunter is a paid third party, so it is only used when
// HUNTER_API_KEY is set, and what it returns is saved to the run folder as data for the sourcer to
// choose from. `ingest-sourced` later accepts an `email_source: "hunter"` address only if it is in
// that saved file, so the agent cannot claim a Hunter source it never queried.

const ENDPOINT = 'https://api.hunter.io/v2/domain-search';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ADDRESSES = 10;

export class HunterError extends Error {}

const HunterEmailSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  position: z.string().nullable(),
  confidence: z.number().nullable(),
  type: z.string().nullable(),
});

export const HunterFileSchema = z.object({
  domain: z.string(),
  fetchedAt: z.string(),
  emails: z.array(HunterEmailSchema),
});
export type HunterFile = z.infer<typeof HunterFileSchema>;

const nullableText = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const ApiEmailSchema = z.object({
  value: z.string().email(),
  first_name: nullableText,
  last_name: nullableText,
  position: nullableText,
  confidence: z
    .number()
    .nullish()
    .transform((value) => value ?? null),
  type: nullableText,
});

const ApiResponseSchema = z.object({ data: z.object({ emails: z.array(z.unknown()) }) });

export type HunterOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'ok'; domain: string; file: string; count: number };

export interface HunterInput {
  layout: RunLayout;
  domain: string;
  /** From HUNTER_API_KEY; null when it is not set. */
  apiKey: string | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

function toHunterEmails(rawEmails: readonly unknown[]): HunterFile['emails'] {
  const emails: HunterFile['emails'] = [];
  for (const raw of rawEmails) {
    const parsed = ApiEmailSchema.safeParse(raw);
    if (!parsed.success) continue;
    const { value, first_name, last_name, position, confidence, type } = parsed.data;
    const name = [first_name, last_name].filter(Boolean).join(' ');
    emails.push({ email: value.toLowerCase(), name: name === '' ? null : name, position, confidence, type });
  }
  return emails;
}

/**
 * Looks up the addresses Hunter knows for a domain and saves them to runs/<id>/sourcing/hunter/<domain>.json.
 * The key goes in a header, never in the URL, and no error message repeats it or anything Hunter sent back.
 */
export async function runHunter(input: HunterInput): Promise<HunterOutcome> {
  if (input.apiKey === null) {
    return {
      status: 'skipped',
      reason:
        'HUNTER_API_KEY is not set, so the Hunter lookup was skipped (it is optional). Use addresses published on the company pages.',
    };
  }
  const domain = normalizeDomain(input.domain);
  if (domain === null) throw new HunterError(`"${input.domain}" is not a valid domain`);

  const url = new URL(ENDPOINT);
  url.searchParams.set('domain', domain);
  url.searchParams.set('limit', String(MAX_ADDRESSES));

  let response: Response;
  try {
    response = await (input.fetchFn ?? fetch)(url, {
      headers: { 'X-API-KEY': input.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
    throw new HunterError(timedOut ? 'Hunter request timed out' : 'Hunter request failed (network error)');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HunterError(`Hunter answered HTTP ${response.status}`);
  }

  const body = ApiResponseSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) throw new HunterError('Hunter answered with an unexpected shape');

  const emails = toHunterEmails(body.data.data.emails);
  const saved: HunterFile = { domain, fetchedAt: (input.now?.() ?? new Date()).toISOString(), emails };
  const file = input.layout.hunterFile(domain);
  await writeJsonAtomic(file, saved);
  return { status: 'ok', domain, file: relativeToRoot(input.layout.paths, file), count: emails.length };
}

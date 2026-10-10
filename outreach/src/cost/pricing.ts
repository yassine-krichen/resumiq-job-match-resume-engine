import { z } from 'zod';

// API list prices in USD per million tokens, keyed by a model id prefix ("claude-opus-5-5" matches
// "claude-opus-5-5-20261001"); the longest matching prefix wins. On a Claude subscription nothing is billed
// per token: the result is the API-equivalent cost, a measure of quota use.

export const ModelRateSchema = z.object({
  input: z.number().min(0),
  output: z.number().min(0),
  cache_write_5m: z.number().min(0),
  cache_read: z.number().min(0),
});

export const PricingSchema = z.record(z.string().trim().min(1), ModelRateSchema);

export type ModelRate = z.infer<typeof ModelRateSchema>;
export type Pricing = z.infer<typeof PricingSchema>;

export interface TokenCounts {
  input: number;
  output: number;
  /** cache_creation_input_tokens, priced at the 5-minute cache write rate. */
  cache_write: number;
  cache_read: number;
}

/** Where DEFAULT_PRICING comes from; copied into the example config as `pricing_source`. */
export const DEFAULT_PRICING_SOURCE =
  'https://platform.claude.com/docs/en/about-claude/pricing (Claude API pricing page, checked 2026-10-10)';

export const DEFAULT_PRICING: Pricing = {
  'claude-fable-5-1': { input: 10, output: 50, cache_write_5m: 12.5, cache_read: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cache_write_5m: 12.5, cache_read: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cache_write_5m: 5, cache_read: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cache_write_5m: 6.25, cache_read: 0.5 },
  'claude-opus-4': { input: 5, output: 25, cache_write_5m: 6.25, cache_read: 0.5 },
  'claude-opus-4-1': { input: 15, output: 75, cache_write_5m: 18.75, cache_read: 1.5 },
  'claude-opus-4-2025': { input: 15, output: 75, cache_write_5m: 18.75, cache_read: 1.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache_write_5m: 2.5, cache_read: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cache_write_5m: 2.5, cache_read: 0.2 },
  'claude-sonnet-4': { input: 3, output: 15, cache_write_5m: 3.75, cache_read: 0.3 },
  // Haiku 5.5 is priced for prompts up to 100,000 tokens; longer prompts cost more, which a subagent rarely reaches.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cache_write_5m: 0.125, cache_read: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cache_write_5m: 1.25, cache_read: 0.1 },
};

/** The rate of the longest key that prefixes `model`, or null for a model nobody priced. */
export function rateFor(model: string, pricing: Pricing): ModelRate | null {
  const wanted = model.toLowerCase();
  let best: { key: string; rate: ModelRate } | null = null;
  for (const [key, rate] of Object.entries(pricing)) {
    const prefix = key.toLowerCase();
    if (wanted.startsWith(prefix) && (best === null || prefix.length > best.key.length)) best = { key: prefix, rate };
  }
  return best?.rate ?? null;
}

export function emptyTokens(): TokenCounts {
  return { input: 0, output: 0, cache_write: 0, cache_read: 0 };
}

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_write: a.cache_write + b.cache_write,
    cache_read: a.cache_read + b.cache_read,
  };
}

export function costUsd(tokens: TokenCounts, rate: ModelRate): number {
  return (
    (tokens.input * rate.input +
      tokens.output * rate.output +
      tokens.cache_write * rate.cache_write_5m +
      tokens.cache_read * rate.cache_read) /
    1_000_000
  );
}

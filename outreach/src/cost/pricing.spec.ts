import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DEFAULT_PRICING, costUsd, rateFor } from './pricing';

describe('rateFor', () => {
  it('matches a dated model id by prefix', () => {
    expect(rateFor('claude-opus-5-5-20261001', DEFAULT_PRICING)).toEqual(DEFAULT_PRICING['claude-opus-5-5']);
  });

  it('prefers the longest matching prefix', () => {
    expect(rateFor('claude-opus-5-5', DEFAULT_PRICING)?.input).toBe(4);
    expect(rateFor('claude-opus-5', DEFAULT_PRICING)?.input).toBe(5);
    expect(rateFor('claude-opus-4-1-20250805', DEFAULT_PRICING)?.input).toBe(15);
    expect(rateFor('claude-opus-4-6', DEFAULT_PRICING)?.input).toBe(5);
  });

  it('is case-insensitive and returns null for an unpriced model', () => {
    expect(rateFor('Claude-Haiku-5-5', DEFAULT_PRICING)).not.toBeNull();
    expect(rateFor('gpt-5', DEFAULT_PRICING)).toBeNull();
  });
});

describe('costUsd', () => {
  it('prices the four token kinds per million tokens', () => {
    const rate = { input: 5, output: 25, cache_write_5m: 6.25, cache_read: 0.5 };

    const cost = costUsd({ input: 1_000_000, output: 200_000, cache_write: 400_000, cache_read: 2_000_000 }, rate);

    expect(cost).toBeCloseTo(5 + 5 + 2.5 + 1, 6);
  });
});

describe('example config', () => {
  it('carries the same prices as the defaults used when a config has no pricing section', () => {
    const example = JSON.parse(readFileSync(join(resolve(__dirname, '..', '..'), 'outreach.config.example.json'), 'utf-8')) as {
      pricing: unknown;
      pricing_source: string;
    };

    expect(example.pricing).toEqual(DEFAULT_PRICING);
    expect(example.pricing_source).toMatch(/^https:\/\/platform\.claude\.com\/docs\/en\/about-claude\/pricing .*2026-10-10/);
  });
});

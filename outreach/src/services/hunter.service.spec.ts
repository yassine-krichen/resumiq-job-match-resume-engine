import { existsSync, readFileSync } from 'node:fs';

import { createTempPaths, layoutFor } from '../testing/test-env';

import { HunterError, HunterFileSchema, runHunter } from './hunter.service';

const KEY = 'test-hunter-key-123456';

function respond(
  body: unknown,
  status = 200,
): { fetchFn: typeof fetch; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...((init?.headers ?? {}) as Record<string, string>) } });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const HUNTER_BODY = {
  data: {
    domain: 'acme.fr',
    emails: [
      { value: 'Claire.Martin@acme.fr', type: 'personal', confidence: 92, first_name: 'Claire', last_name: 'Martin', position: 'CTO' },
      { value: 'jobs@acme.fr', type: 'generic', confidence: 60, first_name: null, last_name: null, position: null },
      { type: 'personal', confidence: 90 },
    ],
  },
};

describe('runHunter', () => {
  it('does nothing and says why when no key is set', async () => {
    const layout = layoutFor(createTempPaths());
    const { fetchFn, calls } = respond(HUNTER_BODY);

    const outcome = await runHunter({ layout, domain: 'acme.fr', apiKey: null, fetchFn });

    expect(outcome).toMatchObject({ status: 'skipped' });
    expect(JSON.stringify(outcome)).toContain('HUNTER_API_KEY');
    expect(calls).toHaveLength(0);
    expect(existsSync(layout.sourcingDir)).toBe(false);
  });

  it('saves the addresses Hunter knows for the domain, lowercased, without the key', async () => {
    const layout = layoutFor(createTempPaths());
    const { fetchFn, calls } = respond(HUNTER_BODY);

    const outcome = await runHunter({
      layout,
      domain: 'https://www.Acme.fr/about',
      apiKey: KEY,
      fetchFn,
      now: () => new Date('2026-10-07T10:00:00Z'),
    });

    expect(outcome).toEqual({ status: 'ok', domain: 'acme.fr', file: `runs/${layout.runId}/sourcing/hunter/acme.fr.json`, count: 2 });
    const saved = HunterFileSchema.parse(JSON.parse(readFileSync(layout.hunterFile('acme.fr'), 'utf-8')));
    expect(saved.emails).toEqual([
      { email: 'claire.martin@acme.fr', name: 'Claire Martin', position: 'CTO', confidence: 92, type: 'personal' },
      { email: 'jobs@acme.fr', name: null, position: null, confidence: 60, type: 'generic' },
    ]);
    expect(readFileSync(layout.hunterFile('acme.fr'), 'utf-8')).not.toContain(KEY);
    expect(calls[0].url).toContain('domain=acme.fr');
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].headers['X-API-KEY']).toBe(KEY);
  });

  it('never puts the key in an error, whatever Hunter answers', async () => {
    const layout = layoutFor(createTempPaths());
    const { fetchFn } = respond({ errors: [{ details: `bad key ${KEY}` }] }, 401);

    const failure = await runHunter({ layout, domain: 'acme.fr', apiKey: KEY, fetchFn }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HunterError);
    expect((failure as Error).message).toContain('401');
    expect((failure as Error).message).not.toContain(KEY);
  });

  it('turns a network failure or timeout into a HunterError without the key', async () => {
    const layout = layoutFor(createTempPaths());
    const fetchFn = (async () => {
      throw Object.assign(new Error(`connect failed for key ${KEY}`), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;

    const failure = await runHunter({ layout, domain: 'acme.fr', apiKey: KEY, fetchFn }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HunterError);
    expect((failure as Error).message).not.toContain(KEY);
  });

  it('rejects a domain that is not a host before any request', async () => {
    const layout = layoutFor(createTempPaths());
    const { fetchFn, calls } = respond(HUNTER_BODY);

    await expect(runHunter({ layout, domain: '../../etc', apiKey: KEY, fetchFn })).rejects.toThrow(/domain/i);
    await expect(runHunter({ layout, domain: 'localhost', apiKey: KEY, fetchFn })).rejects.toThrow(/domain/i);
    expect(calls).toHaveLength(0);
  });

  it('rejects an answer that is not the expected shape', async () => {
    const layout = layoutFor(createTempPaths());
    const { fetchFn } = respond({ unexpected: true });
    await expect(runHunter({ layout, domain: 'acme.fr', apiKey: KEY, fetchFn })).rejects.toThrow(HunterError);
  });
});

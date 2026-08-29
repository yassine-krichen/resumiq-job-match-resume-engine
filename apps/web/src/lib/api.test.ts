import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from './api';

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with the parsed JSON body on a successful fetch', async () => {
    const payload = { id: '1', name: 'test' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/profile')).resolves.toEqual(payload);
  });

  it('rejects with an Error (rather than throwing synchronously) on a failed fetch, without leaking to the caller as an unhandled exception', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });
    vi.stubGlobal('fetch', fetchMock);

    let caughtError: Error | null = null;
    let data: unknown = undefined;

    try {
      data = await apiFetch('/profile');
    } catch (err) {
      caughtError = err as Error;
    }

    expect(data).toBeUndefined();
    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError?.message).toContain('404');
  });
});

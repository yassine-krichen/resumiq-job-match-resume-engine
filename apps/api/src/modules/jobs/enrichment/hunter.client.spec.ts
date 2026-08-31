import { HunterClient } from './hunter.client';

describe('HunterClient', () => {
  let client: HunterClient;
  let fetchMock: jest.Mock;
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new HunterClient();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('no-ops and returns null without making a network call when HUNTER_API_KEY is unset', async () => {
    delete process.env.HUNTER_API_KEY;

    const result = await client.findContact('Acme Corp');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses the top result from a successful domain-search response', async () => {
    process.env.HUNTER_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          emails: [
            {
              value: 'jane@acme.com',
              confidence: 92,
              first_name: 'Jane',
              last_name: 'Doe',
              position: 'Head of Talent',
            },
          ],
        },
      }),
    });

    const result = await client.findContact('Acme Corp');

    expect(result).toEqual({
      email: 'jane@acme.com',
      confidence: 92,
      firstName: 'Jane',
      lastName: 'Doe',
      position: 'Head of Talent',
    });
  });

  it('sends the company (not domain) query param when no domain is supplied', async () => {
    process.env.HUNTER_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { emails: [] } }) });

    await client.findContact('Acme Corp');

    const requestedUrl = fetchMock.mock.calls[0][0] as URL;
    expect(requestedUrl.searchParams.get('company')).toBe('Acme Corp');
    expect(requestedUrl.searchParams.get('domain')).toBeNull();
  });

  it('returns null when the API responds with a non-2xx status', async () => {
    process.env.HUNTER_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({ ok: false, status: 429 });

    const result = await client.findContact('Acme Corp');

    expect(result).toBeNull();
  });

  it('returns null when there are no emails in the response', async () => {
    process.env.HUNTER_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { emails: [] } }) });

    const result = await client.findContact('Acme Corp');

    expect(result).toBeNull();
  });

  it('returns null (never throws) when fetch itself rejects', async () => {
    process.env.HUNTER_API_KEY = 'test-key';
    fetchMock.mockRejectedValue(new Error('network unreachable'));

    await expect(client.findContact('Acme Corp')).resolves.toBeNull();
  });
});

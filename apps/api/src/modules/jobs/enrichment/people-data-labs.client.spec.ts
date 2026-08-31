import { PeopleDataLabsClient } from './people-data-labs.client';

describe('PeopleDataLabsClient', () => {
  let client: PeopleDataLabsClient;
  let fetchMock: jest.Mock;
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new PeopleDataLabsClient();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('no-ops and returns null without making a network call when PDL_API_KEY is unset', async () => {
    delete process.env.PDL_API_KEY;

    const result = await client.findCompanyProfile('Acme Corp');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses a successful company-enrichment response', async () => {
    process.env.PDL_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        industry: 'fintech',
        size: '51-200',
        founded: 2015,
        summary: 'We build payment infra.',
        tags: ['payments', 'b2b'],
      }),
    });

    const result = await client.findCompanyProfile('Acme Corp');

    expect(result).toEqual({
      industry: 'fintech',
      size: '51-200',
      founded: 2015,
      summary: 'We build payment infra.',
      tags: ['payments', 'b2b'],
    });
  });

  it('sends the API key via the X-Api-Key header', async () => {
    process.env.PDL_API_KEY = 'secret-key';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await client.findCompanyProfile('Acme Corp');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ headers: { 'X-Api-Key': 'secret-key' } }),
    );
  });

  it('returns null when the API responds with a non-2xx status', async () => {
    process.env.PDL_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const result = await client.findCompanyProfile('Unknown Co');

    expect(result).toBeNull();
  });

  it('filters out non-string tags from a malformed response body', async () => {
    process.env.PDL_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tags: ['valid', 42, null, 'also-valid'] }),
    });

    const result = await client.findCompanyProfile('Acme Corp');

    expect(result?.tags).toEqual(['valid', 'also-valid']);
  });

  it('returns null (never throws) when fetch itself rejects', async () => {
    process.env.PDL_API_KEY = 'test-key';
    fetchMock.mockRejectedValue(new Error('network unreachable'));

    await expect(client.findCompanyProfile('Acme Corp')).resolves.toBeNull();
  });
});

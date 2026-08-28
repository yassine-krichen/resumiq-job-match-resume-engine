import { generateJSON } from './llm';

function mockFreellmapiResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  } as Response;
}

describe('generateJSON', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, FREELLMAPI_API_KEY: 'test-key' };
    delete process.env.USE_LLM_BRIDGE;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('parses a plain JSON body', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockFreellmapiResponse('{"foo":"bar"}'));

    const result = await generateJSON<{ foo: string }>('system', 'user');

    expect(result).toEqual({ foo: 'bar' });
  });

  it('parses JSON wrapped in a ```json fenced block', async () => {
    const content = 'Here you go:\n```json\n{"foo":"bar"}\n```\nHope that helps.';
    global.fetch = jest.fn().mockResolvedValue(mockFreellmapiResponse(content));

    const result = await generateJSON<{ foo: string }>('system', 'user');

    expect(result).toEqual({ foo: 'bar' });
  });

  it('parses JSON embedded in surrounding prose text', async () => {
    const content = 'Sure, the result is {"foo":"bar"} — let me know if you need more.';
    global.fetch = jest.fn().mockResolvedValue(mockFreellmapiResponse(content));

    const result = await generateJSON<{ foo: string }>('system', 'user');

    expect(result).toEqual({ foo: 'bar' });
  });
});

describe('callFreellmapi (via generateJSON)', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.USE_LLM_BRIDGE;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends the correct Authorization header and body shape', async () => {
    process.env.FREELLMAPI_API_KEY = 'my-secret-key';
    process.env.FREELLMAPI_BASE_URL = 'https://example.test/v1';
    process.env.FREELLMAPI_MODEL = 'test-model';

    const fetchMock = jest.fn().mockResolvedValue(mockFreellmapiResponse('{"ok":true}'));
    global.fetch = fetchMock;

    await generateJSON('system prompt', 'user prompt');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer my-secret-key',
    });
    expect(JSON.parse(init.body)).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      temperature: 0.4,
    });
  });

  it('throws when FREELLMAPI_API_KEY is unset', async () => {
    delete process.env.FREELLMAPI_API_KEY;
    global.fetch = jest.fn();

    await expect(generateJSON('system', 'user')).rejects.toThrow(
      'FREELLMAPI_API_KEY is not set',
    );
  });
});

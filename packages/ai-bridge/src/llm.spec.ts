import { generateJSON, LlmValidationError } from './llm';
import type { JsonSchemaLike } from './llm';

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

    await expect(generateJSON('system', 'user')).rejects.toThrow('FREELLMAPI_API_KEY is not set');
  });
});

describe('generateJSON with a schema', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  // Requires { items: string[] }; coerces a bare string into a 1-element array.
  const itemsSchema: JsonSchemaLike<{ items: string[] }> = {
    safeParse(value) {
      const items = (value as { items?: unknown } | null)?.items;
      if (Array.isArray(items) && items.every((i) => typeof i === 'string')) {
        return { success: true, data: { items } };
      }
      if (typeof items === 'string') return { success: true, data: { items: [items] } };
      return { success: false, error: { message: 'items must be string[]' } };
    },
  };

  beforeEach(() => {
    process.env = { ...originalEnv, FREELLMAPI_API_KEY: 'test-key' };
    delete process.env.USE_LLM_BRIDGE;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns a valid first response without making a repair call', async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockFreellmapiResponse('{"items":["a","b"]}'));
    global.fetch = fetchMock;

    const result = await generateJSON('system', 'user', itemsSchema);

    expect(result).toEqual({ items: ['a', 'b'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-prompts once with the validation error and returns the repaired object', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(mockFreellmapiResponse('{"items":42}'))
      .mockResolvedValueOnce(mockFreellmapiResponse('{"items":["fixed"]}'));
    global.fetch = fetchMock;

    const result = await generateJSON('system', 'user', itemsSchema);

    expect(result).toEqual({ items: ['fixed'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    expect(repairBody.messages[1].content).toContain('items must be string[]');
  });

  it('throws LlmValidationError after exactly one repair attempt when output stays invalid', async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockFreellmapiResponse('{"items":42}'));
    global.fetch = fetchMock;

    await expect(generateJSON('system', 'user', itemsSchema)).rejects.toBeInstanceOf(
      LlmValidationError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats unparseable text on the first attempt as a validation failure and repairs it', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(mockFreellmapiResponse('sorry, no json here'))
      .mockResolvedValueOnce(mockFreellmapiResponse('{"items":[]}'));
    global.fetch = fetchMock;

    const result = await generateJSON('system', 'user', itemsSchema);

    expect(result).toEqual({ items: [] });
  });
});

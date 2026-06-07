import OpenAI from 'openai';

type Provider = 'groq' | 'ollama';

const provider = (process.env.LLM_PROVIDER ?? 'groq') as Provider;

const providerConfig: Record<Provider, { baseURL: string; apiKey: () => string }> = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: () => {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error('GROQ_API_KEY not set in .env');
      return key;
    },
  },
  ollama: {
    baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    apiKey: () => 'ollama',
  },
};

const cfg = providerConfig[provider];
if (!cfg) throw new Error(`Unknown LLM_PROVIDER "${provider}" — must be groq or ollama`);

const client = new OpenAI({ apiKey: cfg.apiKey(), baseURL: cfg.baseURL });

const model =
  process.env.LLM_MODEL ??
  (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'llama3.2');

export async function generateJSON<T>(system: string, user: string): Promise<T> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty response');

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`LLM returned invalid JSON:\n${content.slice(0, 500)}`);
  }
}

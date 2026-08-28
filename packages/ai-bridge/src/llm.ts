// ── Provider types ──────────────────────────────────────────────────────────

type Provider =
  | { kind: 'freellmapi' }
  | { kind: 'bridge'; provider: 'claude' | 'chatgpt' };

function selectProvider(): Provider {
  if (process.env.USE_LLM_BRIDGE === 'true') {
    return {
      kind: 'bridge',
      provider: (process.env.BRIDGE_PROVIDER ?? 'claude') as 'claude' | 'chatgpt',
    };
  }
  return { kind: 'freellmapi' };
}

// ── Backend callers ─────────────────────────────────────────────────────────

interface BridgeResponse {
  response: string;
  sessionId: string;
}

// Reuse browser slots across agent calls — pool size is limited (e.g. 2).
// Caching sessionId per provider means all 3 agents share one slot each.
const bridgeSessionIds = new Map<'claude' | 'chatgpt', string>();

async function callBridge(
  system: string,
  user: string,
  provider: 'claude' | 'chatgpt',
): Promise<string> {
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3000';
  const prompt = `${system}\n\n---\n\n${user}`;
  const sessionId = bridgeSessionIds.get(provider);

  const res = await fetch(`${bridgeUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      provider,
      stream: false,
      ...(sessionId ? { sessionId } : {}),
    }),
    signal: AbortSignal.timeout(300_000), // 5 min — browser automation is slow
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bridge HTTP ${res.status} (${provider}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as BridgeResponse;
  if (data.sessionId) bridgeSessionIds.set(provider, data.sessionId);
  return data.response;
}

async function callFreellmapi(system: string, user: string): Promise<string> {
  const baseUrl = process.env.FREELLMAPI_BASE_URL ?? 'https://freellmapi-19vj.onrender.com/v1';
  const apiKey = process.env.FREELLMAPI_API_KEY;
  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not set');
  const model = process.env.FREELLMAPI_MODEL ?? 'auto';

  const request = () =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(120_000),
    });

  let res = await request();

  if (res.status === 429 || res.status >= 500) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await request();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Freellmapi HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

// ── JSON extraction ─────────────────────────────────────────────────────────

function extractJSON<T>(text: string): T {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  // Unwrap ```json ... ``` or ``` ... ``` fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {}
  }

  // Last resort: walk every { position left-to-right, try each as JSON start
  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace !== -1) {
    let start = trimmed.indexOf('{');
    while (start !== -1 && start < lastBrace) {
      try {
        return JSON.parse(trimmed.slice(start, lastBrace + 1)) as T;
      } catch {}
      start = trimmed.indexOf('{', start + 1);
    }
  }

  throw new Error(`Could not parse JSON from LLM response:\n${text.slice(0, 600)}`);
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function generateJSON<T>(system: string, user: string): Promise<T> {
  const provider = selectProvider();

  const text =
    provider.kind === 'freellmapi'
      ? await callFreellmapi(system, user)
      : await callBridge(system, user, provider.provider);

  return extractJSON<T>(text);
}

export async function checkBridge(): Promise<void> {
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3000';
  try {
    const res = await fetch(`${bridgeUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `claude-web-bridge not reachable at ${bridgeUrl}\n` +
        `Start it first: cd <bridge-dir> && npm run dev\n` +
        `Cause: ${(err as Error).message}`,
    );
  }
}

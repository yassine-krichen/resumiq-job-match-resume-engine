const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3000';

interface BridgeResponse {
  response: string;
  sessionId: string;
}

async function callBridge(prompt: string, provider: 'claude' | 'chatgpt'): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, provider, stream: false }),
    signal: AbortSignal.timeout(300_000), // 5 min — browser automation is slow for large prompts
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bridge HTTP ${res.status} (${provider}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as BridgeResponse;
  return data.response;
}

function extractJSON<T>(text: string): T {
  const trimmed = text.trim();

  // Direct parse (ideal case — model followed instructions)
  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  // Unwrap ```json ... ``` or ``` ... ``` code fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {}
  }

  // Last resort: grab the outermost {...} block
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(trimmed.slice(braceStart, braceEnd + 1)) as T;
    } catch {}
  }

  throw new Error(`Could not parse JSON from LLM response:\n${text.slice(0, 600)}`);
}

export async function generateJSON<T>(system: string, user: string): Promise<T> {
  const prompt = `${system}\n\n---\n\n${user}`;

  for (const provider of ['claude', 'chatgpt'] as const) {
    try {
      const text = await callBridge(prompt, provider);
      return extractJSON<T>(text);
    } catch (err) {
      const isLast = provider === 'chatgpt';
      if (isLast) throw err;
      console.warn(`  claude failed (${(err as Error).message.slice(0, 100)}) — trying chatgpt...`);
    }
  }

  // unreachable — TypeScript needs the return type
  throw new Error('All providers failed');
}

export async function checkBridge(): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `claude-web-bridge not reachable at ${BRIDGE_URL}\n` +
        `Start it first: cd <bridge-dir> && npm run dev\n` +
        `Cause: ${(err as Error).message}`,
    );
  }
}

// ── Provider types ──────────────────────────────────────────────────────────

type Provider = { kind: 'freellmapi' } | { kind: 'bridge'; provider: 'claude' | 'chatgpt' };

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
      // freellmapi's "auto" pool (rotating free-tier models) has heavy
      // latency variance — measured live against the onboarding-ingest
      // prompt: min 32.5s, p50 ~60s, max 113.6s across 8 real calls (see
      // `apps/api/src/modules/onboarding/onboarding.service.ts`'s
      // `PARSE_TIMEOUT_MS` comment). This hard abort needs headroom above
      // that caller-side soft timeout (120s) so a request that's about to
      // succeed isn't killed here first.
      signal: AbortSignal.timeout(180_000),
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

export function extractJSON<T>(text: string): T {
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

// ── Validation + repair ─────────────────────────────────────────────────────

/** Structural subset of a Zod schema — keeps this package free of a direct
 * `zod` import while accepting any `z.ZodType` (including coercing ones). */
export interface JsonSchemaLike<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

/**
 * Thrown by `generateJSON` when the model's output is still not valid after
 * the single repair retry. Callers should catch it and show a retryable
 * message rather than letting a malformed shape reach persistence/rendering.
 */
export class LlmValidationError extends Error {
  constructor(
    message: string,
    readonly validationMessage: string,
    readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'LlmValidationError';
  }
}

const MAX_VALIDATION_MESSAGE_CHARS = 1500;

function buildRepairPrompt(user: string, badOutput: string, problem: string): string {
  return (
    `${user}

---

` +
    `Your previous reply did not match the required JSON shape.
` +
    `Previous reply:
${badOutput.slice(0, 4000)}

` +
    `Problem:
${problem.slice(0, MAX_VALIDATION_MESSAGE_CHARS)}

` +
    `Reply again with ONLY the corrected JSON object, matching the schema exactly.`
  );
}

function tryValidate<T>(
  text: string,
  schema: JsonSchemaLike<T>,
): { ok: true; data: T } | { ok: false; problem: string } {
  let parsed: unknown;
  try {
    parsed = extractJSON<unknown>(text);
  } catch (err) {
    return { ok: false, problem: (err as Error).message };
  }
  const result = schema.safeParse(parsed);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, problem: result.error.message };
}

// ── Public API ──────────────────────────────────────────────────────────────

async function callProvider(system: string, user: string): Promise<string> {
  const provider = selectProvider();
  return provider.kind === 'freellmapi'
    ? callFreellmapi(system, user)
    : callBridge(system, user, provider.provider);
}

/**
 * Calls the configured LLM and returns parsed JSON.
 *
 * With a `schema`, the output is validated (and coerced by the schema); on
 * failure the model is re-prompted ONCE with the validation error, and if that
 * also fails a `LlmValidationError` is thrown. Without a schema the output is
 * returned unvalidated (legacy behavior — avoid for new call sites).
 */
export async function generateJSON<T>(
  system: string,
  user: string,
  schema?: JsonSchemaLike<T>,
): Promise<T> {
  const text = await callProvider(system, user);

  if (!schema) return extractJSON<T>(text);

  const first = tryValidate(text, schema);
  if (first.ok) return first.data;

  const repairedText = await callProvider(system, buildRepairPrompt(user, text, first.problem));
  const second = tryValidate(repairedText, schema);
  if (second.ok) return second.data;

  throw new LlmValidationError(
    'LLM output failed schema validation after one repair attempt',
    second.problem,
    repairedText.slice(0, 600),
  );
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

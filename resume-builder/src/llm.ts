// ── Provider types ──────────────────────────────────────────────────────────

type Provider =
  | { kind: "bridge"; provider: "claude" | "chatgpt" }
  | { kind: "gemini"; key: string; model: string }
  | { kind: "groq"; key: string; model: string }
  | { kind: "ollama"; baseUrl: string; model: string };

function buildProviderChain(): Provider[] {
  const chain: Provider[] = [];

  // 1. Bridge: claude then chatgpt (skipped individually if LLM_FALLBACK=none)
  const preferred = (process.env.LLM_PREFERRED ?? "claude") as
    | "claude"
    | "chatgpt";
  const fallback = (process.env.LLM_FALLBACK ?? "chatgpt") as
    | "claude"
    | "chatgpt"
    | "none";
  chain.push({ kind: "bridge", provider: preferred });
  if (fallback !== "none" && fallback !== preferred) {
    chain.push({ kind: "bridge", provider: fallback });
  }

  // 2. Gemini keys: GEMINI_API_KEY_1, _2, ... (better context window + JSON quality than Groq)
  const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
  for (let i = 1; ; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (!key) break;
    chain.push({ kind: "gemini", key, model: geminiModel });
  }

  // 3. Groq keys: GROQ_API_KEY_1, _2, _3, ... (stop at first missing key)
  const groqModel = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  for (let i = 1; ; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (!key) break;
    chain.push({ kind: "groq", key, model: groqModel });
  }

  // 4. Ollama — last resort local fallback
  chain.push({
    kind: "ollama",
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL ?? "llama3.2",
  });

  return chain;
}

function providerLabel(p: Provider): string {
  if (p.kind === "bridge") return `bridge:${p.provider}`;
  if (p.kind === "gemini") return `gemini(${p.model})`;
  if (p.kind === "groq") return `groq(${p.model})`;
  return `ollama(${p.model})`;
}

// ── Backend callers ─────────────────────────────────────────────────────────

interface BridgeResponse {
  response: string;
  sessionId: string;
}

// Reuse browser slots across agent calls — pool size is limited (e.g. 2).
// Caching sessionId per provider means all 3 agents share one slot each.
const bridgeSessionIds = new Map<"claude" | "chatgpt", string>();

async function callBridge(
  system: string,
  user: string,
  provider: "claude" | "chatgpt",
): Promise<string> {
  const bridgeUrl = process.env.BRIDGE_URL ?? "http://127.0.0.1:3000";
  const prompt = `${system}\n\n---\n\n${user}`;
  const sessionId = bridgeSessionIds.get(provider);

  const res = await fetch(`${bridgeUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      provider,
      stream: false,
      ...(sessionId ? { sessionId } : {}),
    }),
    signal: AbortSignal.timeout(300_000), // 5 min — browser automation is slow
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge HTTP ${res.status} (${provider}): ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as BridgeResponse;
  if (data.sessionId) bridgeSessionIds.set(provider, data.sessionId);
  return data.response;
}

async function callGemini(
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  // Retry up to 3 times on 429 with exponential backoff (1s, 2s, 4s).
  // Gemini free tier is 15 RPM — rapid sequential calls can hit this.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (res.status === 429) {
      if (attempt < 2) {
        const delayMs = 1000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP 429: ${body.slice(0, 200)}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return data.candidates[0].content.parts[0].text;
  }

  throw new Error("Gemini: unreachable");
}

async function callGroq(
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(120_000), // 2 min
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

async function callOllama(
  baseUrl: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(300_000), // 5 min — local models can be slow
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { message: { content: string } };
  return data.message.content;
}

async function callProvider(
  p: Provider,
  system: string,
  user: string,
): Promise<string> {
  switch (p.kind) {
    case "bridge":
      return callBridge(system, user, p.provider);
    case "gemini":
      return callGemini(p.key, p.model, system, user);
    case "groq":
      return callGroq(p.key, p.model, system, user);
    case "ollama":
      return callOllama(p.baseUrl, p.model, system, user);
  }
}

// ── JSON extraction ─────────────────────────────────────────────────────────

function extractJSON<T>(text: string): T {
  const trimmed = text.trim();

  // Direct parse (ideal case)
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
  // Handles preamble text that itself contains { chars (e.g. "in the {field}")
  const lastBrace = trimmed.lastIndexOf("}");
  if (lastBrace !== -1) {
    let start = trimmed.indexOf("{");
    while (start !== -1 && start < lastBrace) {
      try {
        return JSON.parse(trimmed.slice(start, lastBrace + 1)) as T;
      } catch {}
      start = trimmed.indexOf("{", start + 1);
    }
  }

  throw new Error(
    `Could not parse JSON from LLM response:\n${text.slice(0, 600)}`,
  );
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function generateJSON<T>(
  system: string,
  user: string,
): Promise<T> {
  const chain = buildProviderChain();

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    try {
      const text = await callProvider(provider, system, user);
      return extractJSON<T>(text);
    } catch (err) {
      const isLast = i === chain.length - 1;
      if (isLast) throw err;
      const next = chain[i + 1];
      console.warn(
        `  ${providerLabel(provider)} failed (${(err as Error).message.slice(0, 80)}) → trying ${providerLabel(next)}...`,
      );
    }
  }

  throw new Error("All providers exhausted");
}

export async function checkBridge(): Promise<void> {
  const bridgeUrl = process.env.BRIDGE_URL ?? "http://127.0.0.1:3000";
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

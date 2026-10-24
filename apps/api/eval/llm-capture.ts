import { AsyncLocalStorage } from 'node:async_hooks';

import type { CallInfo } from './eval.types';

// Opt-in instrumentation, installed only by eval entrypoints. It wraps
// global.fetch to record, per logical step, which model freellmapi actually
// routed each chat completion to (the "auto" pool rotates). Production code
// never imports this module.
const store = new AsyncLocalStorage<CallInfo[]>();
let installed = false;

export function installCapture(): void {
  if (installed) return;
  installed = true;
  const realFetch = global.fetch;
  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const calls = store.getStore();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!calls || !url.includes('/chat/completions')) return realFetch(input, init);

    const started = Date.now();
    let res: Response;
    try {
      res = await realFetch(input, init);
    } catch (err) {
      calls.push({ model: null, httpStatus: 0, ms: Date.now() - started });
      throw err;
    }
    let model: string | null = null;
    if (res.ok) {
      try {
        const body = (await res.clone().json()) as { model?: string };
        model = body.model ?? null;
      } catch {
        model = null;
      }
    }
    calls.push({ model, httpStatus: res.status, ms: Date.now() - started });
    return res;
  }) as typeof fetch;
}

export async function captureCalls<T>(
  fn: () => Promise<T>,
): Promise<{ calls: CallInfo[]; value?: T; error?: unknown }> {
  const calls: CallInfo[] = [];
  try {
    const value = await store.run(calls, fn);
    return { calls, value };
  } catch (error) {
    return { calls, error };
  }
}

import path from 'path';
import { pathToFileURL } from 'url';
import type { CareerOpsHttpContext, CareerOpsProvider } from './types';

const PROVIDERS_DIR = path.join(__dirname, '../vendor/career-ops/providers');

// TypeScript compiles this package to CommonJS (matches every other package
// in the repo), and with `module: "CommonJS"` it silently downlevels a
// syntactic `import()` call into `Promise.resolve().then(() => require(...))`
// — which then fails to load the vendored .mjs files, since require() can't
// load real ESM. Routing the call through `new Function` hides it from that
// transform (TS only rewrites `import()` expressions it can see statically),
// so this genuinely runs Node's native dynamic import at runtime. This is
// the standard workaround for loading ESM from a CJS-compiled TS package.
const dynamicImport: (specifier: string) => Promise<unknown> = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<unknown>;

/**
 * The only 9 vendored career-ops provider ids this package ships against —
 * see vendor/career-ops/NOTICE.md. Deliberately not "load whatever .mjs
 * files exist in the directory" (that's career-ops's own _registry.mjs,
 * vendored but unused here) — we want an explicit, typed list so adding
 * provider coverage is a reviewable one-line change.
 */
export const SUPPORTED_PROVIDER_IDS = [
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'smartrecruiters',
  'remoteok',
  'himalayas',
  'remotive',
  'weworkremotely',
] as const;

export type SupportedProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

/**
 * Loads a single vendored career-ops provider module via Node's CJS→ESM
 * dynamic import() interop — the .mjs files are real ESM (top-level
 * `import`/`export`), and this package compiles to CommonJS, so `require()`
 * can't load them directly, but `import()` can (Node handles the CJS↔ESM
 * bridge at runtime; no build tool change needed).
 */
export async function loadProvider(id: SupportedProviderId): Promise<CareerOpsProvider> {
  const fileUrl = pathToFileURL(path.join(PROVIDERS_DIR, `${id}.mjs`)).href;
  const mod = (await dynamicImport(fileUrl)) as { default: CareerOpsProvider };
  return mod.default;
}

/**
 * Builds the HTTP context career-ops providers expect as their `fetch(entry,
 * ctx)` second argument — mirrors providers/_http.mjs's own `makeHttpCtx()`
 * (vendored, but that module doesn't export a way to construct one without
 * pulling in the rest of its retry/DNS-guard internals as a side effect of
 * import, which we want anyway since it wires the SSRF-hardening DNS guard).
 */
export async function makeProviderHttpContext(): Promise<CareerOpsHttpContext> {
  const httpModuleUrl = pathToFileURL(path.join(PROVIDERS_DIR, '_http.mjs')).href;
  const httpModule = (await dynamicImport(httpModuleUrl)) as {
    makeHttpCtx: () => CareerOpsHttpContext;
  };
  return httpModule.makeHttpCtx();
}

/**
 * Loads career-ops's shared HTML → plain-text stripper (used to normalize
 * description-less providers' detail-page JSON-LD, see detail-fetch.ts) —
 * same dynamic-import bridge as the other loaders in this file, so callers
 * don't grow their own copy of the entity-decoding/tag-stripping logic.
 */
export async function loadHtmlToText(): Promise<(content: unknown) => string> {
  const moduleUrl = pathToFileURL(path.join(PROVIDERS_DIR, '_html-to-text.mjs')).href;
  const mod = (await dynamicImport(moduleUrl)) as { htmlToText: (content: unknown) => string };
  return mod.htmlToText;
}

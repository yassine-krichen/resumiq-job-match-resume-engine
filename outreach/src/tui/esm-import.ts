// Ink is published as an ES module with a top-level await, so `require('ink')` (what TypeScript emits for a
// static import in this CommonJS package) fails on every supported Node version. A real dynamic `import()`
// works from CommonJS. TypeScript would rewrite a literal `import('ink')` to `require`, hence the indirection.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

export async function importEsm<T>(specifier: string): Promise<T> {
  return (await dynamicImport(specifier)) as T;
}

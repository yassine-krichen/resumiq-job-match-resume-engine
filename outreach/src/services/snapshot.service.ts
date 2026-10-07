import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { htmlToText } from '../core/snapshot-text';
import type { SnapshotLoader } from '../core/quote-verifier';
import { isSafeSnapshotId } from '../core/quote-verifier';

import { createPinnedFetch, isBlockedAddress } from './net-guard';
import type { HostResolver } from './net-guard';
import { readJsonFile, writeJsonAtomic } from './run-layout';

// A snapshot is the raw evidence for a claim: the researcher fetches a page
// through this script (never through its own tools), the script saves the
// text and records it in manifest.json, and the quote verifier later accepts
// only ids the manifest lists. The researcher reads untrusted web pages, so
// the fetcher also refuses to be pointed at the local machine or network.

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; cold-outreach-research/1.0; +personal research, low volume)';
const ACCEPTED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

export interface SnapshotMeta {
  url: string;
  finalUrl: string;
  fetchedAt: string;
}

const ManifestSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      finalUrl: z.string(),
      fetchedAt: z.string(),
      chars: z.number(),
    }),
  ),
});
export type SnapshotManifest = z.infer<typeof ManifestSchema>;

export interface SnapshotResult {
  snapshotId: string;
  url: string;
  finalUrl: string;
  chars: number;
  truncated: boolean;
}

export interface SnapshotOptions {
  /** Replaces the guarded network fetch; only tests pass this, so the DNS pinning is bypassed. */
  fetchFn?: typeof fetch;
  /** Resolver used by the guarded fetch to look hosts up (injectable for tests). */
  resolveHost?: HostResolver;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  now?: () => Date;
}

export class SnapshotError extends Error {}

// ── URL guard ───────────────────────────────────────────────────────────────
// Host names are checked at connection time by the pinned fetch (net-guard.ts);
// this early check covers what never reaches DNS: other schemes, credentials,
// local-looking names, and IP literals in any spelling. The URL parser has
// already turned decimal, octal and hex IPv4 forms ("2130706433", "0177.0.0.1")
// and bracketed IPv6 into canonical text by the time we look at the host.

function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SnapshotError(`not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SnapshotError(`only http(s) URLs are fetched, got ${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') throw new SnapshotError('URLs with credentials are not fetched');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SnapshotError(`refusing to fetch a local host: ${host}`);
  }
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new SnapshotError(`refusing to fetch a private address: ${host}`);
  }
  return url;
}

// ── Fetching ────────────────────────────────────────────────────────────────

async function readCapped(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

function decode(bytes: Uint8Array, contentType: string): string {
  const label = contentType.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function fetchPage(
  startUrl: string,
  options: Required<Pick<SnapshotOptions, 'fetchFn' | 'timeoutMs' | 'maxBytes' | 'userAgent'>>,
): Promise<{ finalUrl: string; body: string; truncated: boolean }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = assertPublicHttpUrl(current);
    const response = await options
      .fetchFn(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { 'user-agent': options.userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' },
      })
      .catch((error: unknown) => {
        // undici reports the real reason (for example a blocked address) as the error's cause.
        const cause = (error as { cause?: Error }).cause;
        throw new SnapshotError(`fetch failed for ${url.hostname}: ${cause?.message ?? (error as Error).message}`);
      });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new SnapshotError(`redirect ${response.status} without a Location header`);
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SnapshotError(`HTTP ${response.status} for ${url.toString()}`);
    }
    const contentType = response.headers.get('content-type') ?? 'text/html';
    if (!ACCEPTED_TYPES.some((type) => contentType.toLowerCase().startsWith(type))) {
      await response.body?.cancel();
      throw new SnapshotError(`unsupported content type "${contentType}" (only HTML and plain text are saved)`);
    }
    const { bytes, truncated } = await readCapped(response, options.maxBytes);
    const raw = decode(bytes, contentType);
    const body = contentType.toLowerCase().startsWith('text/plain') ? raw.replace(/\r\n?/g, '\n').trim() : htmlToText(raw);
    return { finalUrl: url.toString(), body, truncated };
  }
  throw new SnapshotError(`too many redirects (more than ${MAX_REDIRECTS})`);
}

async function readManifest(dir: string): Promise<SnapshotManifest> {
  const read = await readJsonFile(join(dir, 'manifest.json'));
  if (read.status === 'missing') return { entries: [] };
  if (read.status === 'invalid') throw new SnapshotError(`manifest.json in ${dir} is ${read.error}`);
  const parsed = ManifestSchema.safeParse(read.value);
  if (!parsed.success) throw new SnapshotError(`manifest.json in ${dir} has an unexpected shape`);
  return parsed.data;
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

// A researcher may run several snapshot commands at once; the manifest is a
// read-modify-write file, so serialise them with an exclusive lock file.
async function withManifestLock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const lockPath = join(dir, 'manifest.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = await stat(lockPath).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) await rm(lockPath, { force: true });
      else if (Date.now() > deadline) throw new SnapshotError('timed out waiting for the manifest lock');
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await action();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/**
 * Fetches `url`, saves `<sha1>.txt` and `<sha1>.meta.json` in `dir` and lists
 * the page in `dir/manifest.json`. The id is derived from the requested URL,
 * so fetching the same URL again overwrites rather than duplicates.
 */
export async function snapshotUrl(url: string, dir: string, options: SnapshotOptions = {}): Promise<SnapshotResult> {
  const pinned = options.fetchFn ? null : createPinnedFetch(options.resolveHost);
  let page: Awaited<ReturnType<typeof fetchPage>>;
  try {
    page = await fetchPage(url.trim(), {
      fetchFn: options.fetchFn ?? (pinned as NonNullable<typeof pinned>).fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    });
  } finally {
    await pinned?.close();
  }
  if (page.body.length < 50) {
    throw new SnapshotError('the page has almost no readable text (it is probably rendered by JavaScript)');
  }

  const hash = createHash('sha1').update(url.trim()).digest('hex');
  const snapshotId = `${hash}.txt`;
  const meta: SnapshotMeta = {
    url: url.trim(),
    finalUrl: page.finalUrl,
    fetchedAt: (options.now?.() ?? new Date()).toISOString(),
  };

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, snapshotId), `${page.body}\n`, 'utf-8');
  await writeJsonAtomic(join(dir, `${hash}.meta.json`), meta);

  await withManifestLock(dir, async () => {
    const manifest = await readManifest(dir);
    const entries = manifest.entries.filter((entry) => entry.id !== snapshotId);
    entries.push({ id: snapshotId, ...meta, chars: page.body.length });
    await writeJsonAtomic(join(dir, 'manifest.json'), { entries });
  });

  return { snapshotId, url: meta.url, finalUrl: meta.finalUrl, chars: page.body.length, truncated: page.truncated };
}

/**
 * Loader for the quote verifier. It resolves ids only through manifest.json,
 * so a file the researcher dropped into the folder by other means is never
 * accepted as evidence.
 */
export function createManifestSnapshotLoader(dir: string): SnapshotLoader {
  return async (snapshotId) => {
    if (!isSafeSnapshotId(snapshotId)) return null;
    let manifest: SnapshotManifest;
    try {
      manifest = await readManifest(dir);
    } catch {
      return null;
    }
    const entry = manifest.entries.find((candidate) => candidate.id === snapshotId);
    if (!entry || !entry.id.endsWith('.txt')) return null;
    try {
      const text = await readFile(join(dir, entry.id), 'utf-8');
      return { text, url: entry.url, finalUrl: entry.finalUrl };
    } catch {
      return null;
    }
  };
}

/** The text of every snapshot listed in the manifest (none when the folder has no manifest). */
export async function loadManifestSnapshotTexts(dir: string): Promise<string[]> {
  let manifest: SnapshotManifest;
  try {
    manifest = await readManifest(dir);
  } catch {
    return [];
  }
  const load = createManifestSnapshotLoader(dir);
  const records = await Promise.all(manifest.entries.map((entry) => load(entry.id)));
  return records.flatMap((record) => (record === null ? [] : [record.text]));
}

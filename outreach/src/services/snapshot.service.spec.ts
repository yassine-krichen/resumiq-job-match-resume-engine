import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createManifestSnapshotLoader, snapshotUrl } from './snapshot.service';
import type { SnapshotOptions } from './snapshot.service';

const PAGE = '<html><body><h1>Acme Robotics</h1><p>Today we are open-sourcing the Acme fleet scheduler for warehouses.</p></body></html>';

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
}

function options(fetchFn: (url: URL | string) => Promise<Response>, extra: SnapshotOptions = {}): SnapshotOptions {
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => new Date('2026-10-07T10:00:00Z'),
    ...extra,
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'snapshot-test-'));
}

describe('snapshotUrl', () => {
  it('saves readable text, metadata and a manifest entry under a sha1 id', async () => {
    const dir = tempDir();
    const result = await snapshotUrl('https://acme.example/blog', dir, options(async () => htmlResponse(PAGE)));

    expect(result.snapshotId).toMatch(/^[0-9a-f]{40}\.txt$/);
    expect(readFileSync(join(dir, result.snapshotId), 'utf-8')).toContain('Today we are open-sourcing the Acme fleet scheduler');
    const meta = JSON.parse(readFileSync(join(dir, result.snapshotId.replace('.txt', '.meta.json')), 'utf-8'));
    expect(meta).toEqual({ url: 'https://acme.example/blog', finalUrl: 'https://acme.example/blog', fetchedAt: '2026-10-07T10:00:00.000Z' });
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    expect(manifest.entries.map((entry: { id: string }) => entry.id)).toEqual([result.snapshotId]);
  });

  it('records the final URL after a redirect', async () => {
    const dir = tempDir();
    const fetchFn = async (url: URL | string): Promise<Response> =>
      String(url).endsWith('/old')
        ? new Response(null, { status: 301, headers: { location: '/new' } })
        : htmlResponse(PAGE);
    const result = await snapshotUrl('https://acme.example/old', dir, options(fetchFn));
    expect(result.finalUrl).toBe('https://acme.example/new');
    expect(result.url).toBe('https://acme.example/old');
  });

  it('refuses a redirect that points at a private address', async () => {
    const dir = tempDir();
    const fetchFn = async (): Promise<Response> => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
    await expect(snapshotUrl('https://acme.example/x', dir, options(fetchFn))).rejects.toThrow(/private address/);
  });

  it('refuses hosts that resolve to a private address (real guarded fetch, nothing is contacted)', async () => {
    const dir = tempDir();
    await expect(
      snapshotUrl('https://internal.example/', dir, { resolveHost: async () => ['10.0.0.5'] }),
    ).rejects.toThrow(/private|non-public/);
    await expect(
      snapshotUrl('https://rebind.example/', dir, { resolveHost: async () => ['93.184.216.34', '169.254.169.254'] }),
    ).rejects.toThrow(/private|non-public/);
  });

  it('refuses localhost, non-http schemes and URLs with credentials', async () => {
    const dir = tempDir();
    const fetchFn = async (): Promise<Response> => htmlResponse(PAGE);
    await expect(snapshotUrl('http://localhost:3000/', dir, options(fetchFn))).rejects.toThrow(/local host/);
    await expect(snapshotUrl('file:///etc/passwd', dir, options(fetchFn))).rejects.toThrow(/only http/);
    await expect(snapshotUrl('https://user:pw@acme.example/', dir, options(fetchFn))).rejects.toThrow(/credentials/);
  });

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:a9fe:a9fe::]/',
    'http://[fec0::1]/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0/',
  ])('never fetches the IP literal %s', async (target) => {
    let calls = 0;
    const fetchFn = async (): Promise<Response> => {
      calls += 1;
      return htmlResponse(PAGE);
    };
    await expect(snapshotUrl(target, tempDir(), options(fetchFn))).rejects.toThrow(/private address/);
    expect(calls).toBe(0);
  });

  it('refuses a redirect to an IPv4-mapped IPv6 literal', async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(null, { status: 302, headers: { location: 'http://[::ffff:7f00:1]/admin' } });
    await expect(snapshotUrl('https://acme.example/x', tempDir(), options(fetchFn))).rejects.toThrow(/private address/);
  });

  it('rejects non-HTML content, HTTP errors and pages with no readable text', async () => {
    const dir = tempDir();
    await expect(
      snapshotUrl('https://acme.example/a.pdf', dir, options(async () => new Response('x', { headers: { 'content-type': 'application/pdf' } }))),
    ).rejects.toThrow(/unsupported content type/);
    await expect(snapshotUrl('https://acme.example/404', dir, options(async () => new Response('no', { status: 404 })))).rejects.toThrow(/HTTP 404/);
    await expect(
      snapshotUrl('https://acme.example/spa', dir, options(async () => htmlResponse('<html><body><div id="root"></div><script>1</script></body></html>'))),
    ).rejects.toThrow(/almost no readable text/);
  });

  it('caps the saved size and says so', async () => {
    const dir = tempDir();
    const big = `<p>${'fleet scheduler '.repeat(5000)}</p>`;
    const result = await snapshotUrl('https://acme.example/big', dir, options(async () => htmlResponse(big), { maxBytes: 1000 }));
    expect(result.truncated).toBe(true);
    expect(readFileSync(join(dir, result.snapshotId), 'utf-8').length).toBeLessThan(1100);
  });

  it('keeps every entry when snapshots run at the same time', async () => {
    const dir = tempDir();
    const fetchFn = async (url: URL | string): Promise<Response> =>
      htmlResponse(`<p>${String(url)} has a page with enough readable text to be saved as evidence.</p>`);
    const urls = ['a', 'b', 'c', 'd', 'e'].map((name) => `https://acme.example/${name}`);
    await Promise.all(urls.map((url) => snapshotUrl(url, dir, options(fetchFn))));
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    expect(manifest.entries).toHaveLength(5);
  });
});

describe('createManifestSnapshotLoader', () => {
  it('loads a listed snapshot with its URLs', async () => {
    const dir = tempDir();
    const saved = await snapshotUrl('https://acme.example/blog', dir, options(async () => htmlResponse(PAGE)));
    const record = await createManifestSnapshotLoader(dir)(saved.snapshotId);
    expect(record?.url).toBe('https://acme.example/blog');
    expect(record?.text).toContain('open-sourcing');
  });

  it('ignores a file that is in the folder but not in the manifest', async () => {
    const dir = tempDir();
    await snapshotUrl('https://acme.example/blog', dir, options(async () => htmlResponse(PAGE)));
    const forged = `${'a'.repeat(40)}.txt`;
    writeFileSync(join(dir, forged), 'Today we are open-sourcing the Acme fleet scheduler.');
    expect(await createManifestSnapshotLoader(dir)(forged)).toBeNull();
  });

  it('returns null for unsafe ids and for a folder with no manifest', async () => {
    const loader = createManifestSnapshotLoader(tempDir());
    expect(await loader('../manifest.json')).toBeNull();
    expect(await loader('abc.txt')).toBeNull();
  });
});

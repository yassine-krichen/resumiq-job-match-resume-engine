import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createGuardedLookup, createPinnedFetch, isBlockedAddress } from './net-guard';

describe('isBlockedAddress: IPv4', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks %s', (address) => expect(isBlockedAddress(address)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '100.63.255.255', '100.128.0.1', '198.20.0.1', '11.0.0.1'])(
    'allows %s',
    (address) => expect(isBlockedAddress(address)).toBe(false),
  );
});

describe('isBlockedAddress: IPv6', () => {
  it.each(['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'feff::1', 'ff02::1', '2001:db8::1'])(
    'blocks %s',
    (address) => expect(isBlockedAddress(address)).toBe(true),
  );

  it.each([
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, dotted'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata address'],
    ['::ffff:10.0.0.5', 'IPv4-mapped private'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['::a9fe:a9fe', 'IPv4-compatible metadata address'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 metadata address'],
    ['64:ff9b::7f00:1', 'NAT64 loopback'],
    ['2002:a9fe:a9fe::', '6to4 metadata address'],
    ['2002:7f00:1::1', '6to4 loopback'],
    ['2002:0a00:0001::', '6to4 private 10/8'],
  ])('blocks %s (%s)', (address) => expect(isBlockedAddress(address)).toBe(true));

  it.each([
    ['2606:4700:4700::1111', 'public'],
    ['2001:4860:4860::8888', 'public'],
    ['::ffff:93.184.216.34', 'IPv4-mapped public'],
    ['64:ff9b::5db8:d822', 'NAT64 public'],
    ['2002:5db8:d822::', '6to4 public'],
  ])('allows %s (%s)', (address) => expect(isBlockedAddress(address)).toBe(false));

  it('blocks anything that is not a valid IP address', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress('1.2.3')).toBe(true);
  });

  it('ignores an IPv6 zone id when classifying', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true);
  });
});

type LookupResult = { error: Error | null; address?: string; family?: number; all?: Array<{ address: string; family: number }> };

function runLookup(
  lookup: ReturnType<typeof createGuardedLookup>,
  hostname: string,
  options: { all?: boolean; family?: number } = {},
): Promise<LookupResult> {
  return new Promise((resolve) => {
    (lookup as unknown as (h: string, o: object, cb: (...args: unknown[]) => void) => void)(hostname, options, (error, address, family) => {
      if (Array.isArray(address)) resolve({ error: (error as Error) ?? null, all: address as LookupResult['all'] });
      else resolve({ error: (error as Error) ?? null, address: address as string, family: family as number });
    });
  });
}

describe('createGuardedLookup (DNS rebinding guard)', () => {
  it('returns the checked public address so the connection is pinned to it', async () => {
    const lookup = createGuardedLookup(async () => ['93.184.216.34']);
    expect(await runLookup(lookup, 'acme.example')).toEqual({ error: null, address: '93.184.216.34', family: 4 });
  });

  it('returns every checked address when the caller asks for all of them', async () => {
    const lookup = createGuardedLookup(async () => ['93.184.216.34', '2606:4700:4700::1111']);
    const result = await runLookup(lookup, 'acme.example', { all: true });
    expect(result.all).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('rejects a host that resolves to a private address', async () => {
    const lookup = createGuardedLookup(async () => ['10.0.0.5']);
    const result = await runLookup(lookup, 'internal.example');
    expect(result.error?.message).toMatch(/private|non-public/i);
  });

  it('rejects when ANY returned address is private, not only the first', async () => {
    const lookup = createGuardedLookup(async () => ['93.184.216.34', '169.254.169.254']);
    expect((await runLookup(lookup, 'mixed.example')).error).not.toBeNull();
  });

  it('checks again on every connection, so a rebind from public to private is caught', async () => {
    let calls = 0;
    const lookup = createGuardedLookup(async () => (calls++ === 0 ? ['93.184.216.34'] : ['127.0.0.1']));
    expect((await runLookup(lookup, 'rebind.example')).error).toBeNull();
    expect((await runLookup(lookup, 'rebind.example')).error).not.toBeNull();
  });

  it('fails closed when resolution fails or returns nothing', async () => {
    expect((await runLookup(createGuardedLookup(async () => []), 'a.example')).error).not.toBeNull();
    expect(
      (
        await runLookup(
          createGuardedLookup(async () => {
            throw new Error('ENOTFOUND');
          }),
          'b.example',
        )
      ).error,
    ).not.toBeNull();
  });
});

describe('createPinnedFetch', () => {
  it('never connects to a local server when the hostname resolves to a loopback address', async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.end('secret');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const pinned = createPinnedFetch(async () => ['127.0.0.1']);
    try {
      await expect(pinned.fetch(`http://rebind.example:${port}/`, { redirect: 'manual' })).rejects.toThrow();
      expect(hits).toBe(0);
    } finally {
      await pinned.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

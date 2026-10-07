import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

// The researcher agent chooses the URLs the snapshot script fetches, after
// reading untrusted pages. Two defences keep it from reaching the local machine
// or network (cloud metadata, routers, localhost services):
//   1. isBlockedAddress classifies an IP by its bytes, including addresses that
//      wrap an IPv4 one (IPv4-mapped, NAT64, 6to4, IPv4-compatible).
//   2. createPinnedFetch resolves the host itself at connection time, rejects
//      any non-public answer and connects to exactly the address it checked, so
//      a DNS record that changes between "check" and "connect" (rebinding)
//      cannot redirect the request.

const IPV4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['64:ff9b:1::', 48],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

const blocked = new BlockList();
for (const [network, prefix] of IPV4_BLOCKED) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6_BLOCKED) blocked.addSubnet(network, prefix, 'ipv6');

/** Parses any valid IPv6 text (including a dotted IPv4 tail) into its 16 bytes. */
function ipv6Bytes(text: string): Uint8Array {
  let head = text;
  const tail: number[] = [];
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    head = `${dotted[1]}0:0`;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    tail.push(a, b, c, d);
  }
  const [left, right] = head.split('::');
  const toGroups = (part: string | undefined): number[] =>
    part === undefined || part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16));
  const leftGroups = toGroups(left);
  const rightGroups = head.includes('::') ? toGroups(right) : [];
  const groups = head.includes('::')
    ? [...leftGroups, ...Array<number>(8 - leftGroups.length - rightGroups.length).fill(0), ...rightGroups]
    : leftGroups;

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  if (dotted) bytes.set(tail, 12);
  return bytes;
}

function canonicalIpv6(bytes: Uint8Array): string {
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
  return groups.join(':');
}

function ipv4Text(bytes: Uint8Array, offset: number): string {
  return Array.from(bytes.slice(offset, offset + 4)).join('.');
}

const allZero = (bytes: Uint8Array, from: number, to: number): boolean => bytes.slice(from, to).every((byte) => byte === 0);

/**
 * True when the address must not be fetched: private, loopback, link-local,
 * CGNAT, multicast, reserved or documentation ranges, any IPv6 address that
 * wraps one of those, and anything that is not a valid IP address.
 */
export function isBlockedAddress(address: string): boolean {
  const text = address.trim().replace(/^\[|\]$/g, '').split('%')[0];
  const version = isIP(text);
  if (version === 0) return true;
  if (version === 4) return blocked.check(text, 'ipv4');

  const bytes = ipv6Bytes(text);
  // ::ffff:0:0/96 IPv4-mapped
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isBlockedAddress(ipv4Text(bytes, 12));
  // ::/96 IPv4-compatible (deprecated); "::" and "::1" are caught by the plain list below
  if (allZero(bytes, 0, 12) && !allZero(bytes, 12, 16) && !(allZero(bytes, 12, 15) && bytes[15] === 1)) {
    return isBlockedAddress(ipv4Text(bytes, 12));
  }
  // 64:ff9b::/96 NAT64
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(bytes, 4, 12)) {
    return isBlockedAddress(ipv4Text(bytes, 12));
  }
  // 2002::/16 6to4 embeds the IPv4 address in bytes 2-5
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isBlockedAddress(ipv4Text(bytes, 2));

  return blocked.check(canonicalIpv6(bytes), 'ipv6');
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveAllAddresses: HostResolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

interface LookupOptions {
  all?: boolean;
  family?: number | string;
}
type LookupCallback = (error: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void;

export class NonPublicAddressError extends Error {
  readonly code = 'ENONPUBLIC';
}

/**
 * dns.lookup-compatible function for undici's `connect.lookup`. It resolves
 * the host on every connection, fails if ANY answer is non-public, and hands
 * back only the addresses it checked, so the socket opens to a checked IP.
 */
export function createGuardedLookup(resolve: HostResolver = resolveAllAddresses) {
  return (hostname: string, optionsOrFamily: LookupOptions | number | undefined, callback: LookupCallback): void => {
    const options: LookupOptions = typeof optionsOrFamily === 'object' ? optionsOrFamily : { family: optionsOrFamily };
    resolve(hostname).then(
      (answers) => {
        const addresses = answers.map((answer) => answer.split('%')[0]);
        if (addresses.length === 0) return callback(new Error(`host does not resolve: ${hostname}`));
        if (addresses.some(isBlockedAddress)) {
          return callback(new NonPublicAddressError(`refusing to connect: ${hostname} resolves to a private or non-public address`));
        }
        const wantedFamily = Number(options.family ?? 0);
        const usable = addresses
          .map((address) => ({ address, family: isIP(address) }))
          .filter((entry) => wantedFamily === 0 || entry.family === wantedFamily);
        if (usable.length === 0) return callback(new Error(`no usable address for ${hostname}`));
        if (options.all) return callback(null, usable);
        return callback(null, usable[0].address, usable[0].family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  };
}

export interface PinnedFetch {
  fetch: typeof fetch;
  close: () => Promise<void>;
}

/** A fetch whose every connection goes through the guarded lookup. Close it when done. */
export function createPinnedFetch(resolve: HostResolver = resolveAllAddresses): PinnedFetch {
  const dispatcher = new Agent({ connect: { lookup: createGuardedLookup(resolve) as never } });
  return {
    fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch,
    close: () => dispatcher.close(),
  };
}

import { z } from 'zod';

export type Resolve = (hostname: string) => Promise<readonly string[] | null>;
type Fetcher = (request: Request) => Promise<Response>;

const DOH = 'https://cloudflare-dns.com/dns-query';
const ADDRESS_RECORDS = [
  ['A', 1],
  ['AAAA', 28],
] as const;
const privateNames = /(?:^|\.)(?:localhost|internal|local|localdomain|home\.arpa)$/i;
const dottedQuad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const blockedV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
];

const blockedV6: readonly (readonly [string, number])[] = [
  ['::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

const embeddingV4: readonly (readonly [string, number])[] = [
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
];

const dnsReply = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

function v4(address: string): bigint | null {
  const parts = dottedQuad.exec(address)?.slice(1).map(Number);
  if (parts === undefined || parts.some((part) => part > 255)) return null;
  return parts.reduce((total, part) => total * 256n + BigInt(part), 0n);
}

function hextets(half: string): number[] | null {
  if (half === '') return [];
  const groups = half.split(':');
  const tail = groups.at(-1) ?? '';
  const quad = tail.includes('.') ? v4(tail) : null;
  if (tail.includes('.') && quad === null) return null;
  const words = quad === null ? groups : groups.slice(0, -1);
  if (words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
  const parsed = words.map((word) => parseInt(word, 16));
  return quad === null ? parsed : [...parsed, Number(quad >> 16n), Number(quad & 0xffffn)];
}

function v6(address: string): bigint | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = hextets(halves[0] ?? '');
  const tail = halves.length === 2 ? hextets(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const words = [...head, ...Array<number>(Math.max(missing, 0)).fill(0), ...tail];
  return words.reduce((total, word) => total * 65536n + BigInt(word), 0n);
}

function within(value: bigint, ranges: readonly (readonly [string, number])[], bits: number) {
  return ranges.some(([network, length]) => {
    const base = bits === 32 ? v4(network) : v6(network);
    const shift = BigInt(bits - length);
    return base !== null && value >> shift === base >> shift;
  });
}

export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[(.*)\]$/, '$1');
  const four = v4(bare);
  if (four !== null) return !within(four, blockedV4, 32);
  const six = bare.includes(':') ? v6(bare) : null;
  if (six === null || within(six, blockedV6, 128)) return false;
  if (within(six, embeddingV4, 128)) return !within(six & 0xffffffffn, blockedV4, 32);
  return true;
}

function literal(hostname: string): boolean {
  return hostname.startsWith('[') || dottedQuad.test(hostname);
}

export async function publicHost(hostname: string, resolve: Resolve): Promise<boolean> {
  if (literal(hostname)) return isPublicAddress(hostname);
  if (privateNames.test(hostname)) return false;
  const addresses = await resolve(hostname);
  if (addresses === null || addresses.length === 0) return false;
  return addresses.every(isPublicAddress);
}

async function records(fetcher: Fetcher, hostname: string, type: 'A' | 'AAAA', code: number) {
  const query = new URLSearchParams({ name: hostname, type });
  const request = new Request(`${DOH}?${query.toString()}`, {
    headers: { accept: 'application/dns-json' },
  });
  const response = await fetcher(request);
  if (!response.ok) return null;
  const reply = dnsReply.safeParse(await response.json().catch(() => null));
  if (!reply.success || reply.data.Status !== 0) return null;
  return (reply.data.Answer ?? []).filter((one) => one.type === code).map((one) => one.data);
}

export function dohResolver(fetcher: Fetcher): Resolve {
  return async (hostname) => {
    const found = await Promise.all(
      ADDRESS_RECORDS.map(([type, code]) => records(fetcher, hostname, type, code)),
    );
    if (found.every((answer) => answer === null)) return null;
    return found.flatMap((answer) => answer ?? []);
  };
}

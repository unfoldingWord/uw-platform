import { WEB_ADDRESS_LONGEST, type WebAddressRefusal } from '@uw/contracts';

export type WebAddressParts = {
  readonly href: string;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
};

type Range = readonly [base: number, bits: number];

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
const WEB_PORTS: ReadonlySet<string> = new Set(['', '80', '443']);
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet'];
const LOCAL_NAMES: ReadonlySet<string> = new Set(['localhost', 'metadata']);
const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/;

function quad(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

const PRIVATE_V4: readonly Range[] = [
  [quad(0, 0, 0, 0), 8],
  [quad(10, 0, 0, 0), 8],
  [quad(100, 64, 0, 0), 10],
  [quad(127, 0, 0, 0), 8],
  [quad(169, 254, 0, 0), 16],
  [quad(172, 16, 0, 0), 12],
  [quad(192, 0, 0, 0), 24],
  [quad(192, 0, 2, 0), 24],
  [quad(192, 88, 99, 0), 24],
  [quad(192, 168, 0, 0), 16],
  [quad(198, 18, 0, 0), 15],
  [quad(198, 51, 100, 0), 24],
  [quad(203, 0, 113, 0), 24],
  [quad(224, 0, 0, 0), 4],
  [quad(240, 0, 0, 0), 4],
];

function ipv4Of(text: string): number | null {
  const match = DOTTED_QUAD.exec(text);
  if (match === null) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return quad(a, b, c, d);
}

function inRange(address: number, [base, bits]: Range): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) >>> 0 === (base & mask) >>> 0;
}

function privateV4(address: number): boolean {
  return PRIVATE_V4.some((range) => inRange(address, range));
}

function expandedGroups(text: string): readonly number[] | null {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? (halves[1] ?? '').split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(Math.max(0, missing)).fill('0'), ...tail];
  if (!groups.every((group) => IPV6_GROUP.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function publicV6(groups: readonly number[]): boolean {
  const [first = 0, second = 0] = groups;
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2002) return false;
  return !(first === 0x2001 && (second === 0x0db8 || second === 0x0000));
}

export function privateAddress(address: string): boolean {
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const v4 = ipv4Of(bare);
  if (v4 !== null) return privateV4(v4);
  const groups = expandedGroups(bare.toLowerCase());
  return groups === null || !publicV6(groups);
}

function localName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (LOCAL_NAMES.has(name) || !name.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function privateHost(hostname: string): boolean {
  if (hostname.startsWith('[')) return privateAddress(hostname);
  if (ipv4Of(hostname) !== null) return privateAddress(hostname);
  return localName(hostname);
}

export function webAddressRefusal(parts: WebAddressParts): WebAddressRefusal | null {
  if (!WEB_PROTOCOLS.has(parts.protocol)) return 'not_web';
  if (parts.username !== '' || parts.password !== '') return 'credentials';
  if (!WEB_PORTS.has(parts.port)) return 'port';
  if (parts.href.length > WEB_ADDRESS_LONGEST) return 'too_long';
  return privateHost(parts.hostname) ? 'private_address' : null;
}

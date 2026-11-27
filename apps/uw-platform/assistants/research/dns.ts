import { privateAddress } from '@uw/harness';
import { z } from 'zod';
import { jsonCall, type Fetcher } from './http.ts';

export type HostCheck = 'public' | 'private' | 'unresolved' | 'unavailable';

const DNS_OVER_HTTPS_URL = 'https://cloudflare-dns.com/dns-query';

const TIMEOUT_MS = 3_000;
const ADDRESS_TYPES: ReadonlySet<number> = new Set([1, 28]);
const NO_ERROR = 0;
const DIGITS_AND_DOTS = /^[\d.]+$/;

const dnsAnswerSchema = z.object({
  Status: z.number().int(),
  Answer: z.array(z.object({ type: z.number().int(), data: z.string() })).optional(),
});

type Lookup = { readonly status: 'answered'; readonly addresses: readonly string[] } | HostCheck;

async function lookup(fetcher: Fetcher, hostname: string, type: 'A' | 'AAAA'): Promise<Lookup> {
  const url = `${DNS_OVER_HTTPS_URL}?${new URLSearchParams({ name: hostname, type }).toString()}`;
  const init = { method: 'GET', headers: { accept: 'application/dns-json' } };
  const answer = await jsonCall(fetcher, url, init, TIMEOUT_MS);
  if (!answer.ok) return 'unavailable';
  const parsed = dnsAnswerSchema.safeParse(answer.body);
  if (!parsed.success) return 'unavailable';
  if (parsed.data.Status !== NO_ERROR) return 'unresolved';
  const addresses = (parsed.data.Answer ?? [])
    .filter((record) => ADDRESS_TYPES.has(record.type))
    .map((record) => record.data);
  return { status: 'answered', addresses };
}

export async function checkHost(fetcher: Fetcher, hostname: string): Promise<HostCheck> {
  if (hostname.startsWith('[') || DIGITS_AND_DOTS.test(hostname)) {
    return privateAddress(hostname) ? 'private' : 'public';
  }
  const answers = await Promise.all([
    lookup(fetcher, hostname, 'A'),
    lookup(fetcher, hostname, 'AAAA'),
  ]);
  if (answers.includes('unavailable')) return 'unavailable';
  const addresses = answers.flatMap((answer) =>
    typeof answer === 'string' ? [] : answer.addresses,
  );
  if (addresses.length === 0) return 'unresolved';
  return addresses.some((address) => privateAddress(address)) ? 'private' : 'public';
}

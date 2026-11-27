import { WEB_REDIRECTS_MOST, type WebAddressRefusal } from '@uw/contracts';
import { webAddressRefusal } from '@uw/harness';
import { checkHost } from './dns.ts';
import type { Fetcher } from './http.ts';

export type Fetched =
  | { readonly outcome: 'fetched'; readonly url: string; readonly response: Response }
  | { readonly outcome: 'blocked'; readonly why: WebAddressRefusal }
  | { readonly outcome: 'unreadable' | 'unavailable' };

type Hop = { readonly next: string } | { readonly done: Fetched };

const READER_AGENT = 'uw-platform-assistant/1 (read-only research for one person)';

const TIMEOUT_MS = 8_000;
const BODY_MOST = 1_500_000;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

function refusalOf(url: string): WebAddressRefusal | null {
  if (!URL.canParse(url)) return 'not_web';
  return webAddressRefusal(new URL(url));
}

async function hopOf(fetcher: Fetcher, url: string): Promise<Hop> {
  const refusal = refusalOf(url);
  if (refusal !== null) return { done: { outcome: 'blocked', why: refusal } };
  const host = await checkHost(fetcher, new URL(url).hostname);
  if (host === 'private') return { done: { outcome: 'blocked', why: 'private_address' } };
  if (host === 'unresolved') return { done: { outcome: 'unreadable' } };
  if (host === 'unavailable') return { done: { outcome: 'unavailable' } };
  const response = await fetcher(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
      'user-agent': READER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const location = response.headers.get('location');
  if (!REDIRECT_STATUSES.has(response.status) || location === null) {
    return { done: { outcome: 'fetched', url, response } };
  }
  await response.body?.cancel();
  return URL.canParse(location, url)
    ? { next: new URL(location, url).href }
    : { done: { outcome: 'unreadable' } };
}

export async function guardedFetch(fetcher: Fetcher, start: string): Promise<Fetched> {
  let url = start;
  try {
    for (let hop = 0; ; hop += 1) {
      const step = await hopOf(fetcher, url);
      if ('done' in step) return step.done;
      if (hop >= WEB_REDIRECTS_MOST) return { outcome: 'blocked', why: 'too_many_redirects' };
      url = step.next;
    }
  } catch {
    return { outcome: 'unavailable' };
  }
}

export async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let read = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    read += chunk.value.byteLength;
    parts.push(decoder.decode(chunk.value, { stream: true }));
    if (read >= BODY_MOST) {
      await reader.cancel();
      break;
    }
  }
  parts.push(decoder.decode());
  return parts.join('');
}

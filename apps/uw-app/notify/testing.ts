import type { PushSubscribe } from '@uw/contracts';
import type { PushConfig } from './config.ts';

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pairOf(key: CryptoKey | CryptoKeyPair): CryptoKeyPair {
  if ('privateKey' in key) return key;
  throw new Error('expected a key pair');
}

async function rawKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  if (!(raw instanceof ArrayBuffer)) throw new Error('expected raw key bytes');
  return base64Url(raw);
}

async function jwkOf(key: CryptoKey): Promise<JsonWebKey> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  if (jwk instanceof ArrayBuffer) throw new Error('expected a JSON web key');
  return jwk;
}

export type VapidFixture = {
  readonly config: PushConfig;
  readonly env: {
    readonly VAPID_PUBLIC_KEY: string;
    readonly VAPID_SUBJECT: string;
    readonly VAPID_PRIVATE_JWK: string;
  };
};

export async function vapidFixture(): Promise<VapidFixture> {
  const pair = pairOf(
    await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]),
  );
  const publicKey = await rawKey(pair.publicKey);
  const privateJwk = await jwkOf(pair.privateKey);
  const subject = 'mailto:push@unfoldingword.org';
  return {
    config: { publicKey, subject, privateJwk },
    env: {
      VAPID_PUBLIC_KEY: publicKey,
      VAPID_SUBJECT: subject,
      VAPID_PRIVATE_JWK: JSON.stringify(privateJwk),
    },
  };
}

async function deviceKeys(): Promise<PushSubscribe['keys']> {
  const pair = pairOf(
    await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
  );
  return {
    p256dh: await rawKey(pair.publicKey),
    auth: base64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

export async function subscription(
  endpoint: string,
  expirationTime: number | null = null,
): Promise<PushSubscribe> {
  return { endpoint, keys: await deviceKeys(), expirationTime };
}

type FetchCall = {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Uint8Array | string;
};

export type FetchAnswer = (url: string) => Response | Promise<Response>;

export type RecordingFetch = {
  readonly fetcher: typeof fetch;
  readonly calls: FetchCall[];
};

async function bodyOf(init: RequestInit | undefined): Promise<Uint8Array | string> {
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body === undefined || body === null) return '';
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function recordingFetch(answer: FetchAnswer): RecordingFetch {
  const calls: FetchCall[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers), body: await bodyOf(init) });
    return answer(url);
  }) as typeof fetch;
  return { fetcher, calls };
}

export function endpointFor(name: string): string {
  return `https://fcm.googleapis.com/fcm/send/${name}`;
}

export const zulipSite = 'https://chat.example.org';
export const appOrigin = 'https://app.example.org';

export function zulipEnv(channels: Readonly<Record<string, string>>): Record<string, string> {
  return {
    ZULIP_SITE: zulipSite,
    ZULIP_BOT_EMAIL: 'harness-bot@chat.example.org',
    ZULIP_BOT_API_KEY: 'fixture-api-key',
    ZULIP_CHANNELS: JSON.stringify(channels),
  };
}

export type ZulipForm = { readonly to: string; readonly topic: string; readonly content: string };

export function zulipFormOf(body: unknown): ZulipForm {
  const form = new URLSearchParams(typeof body === 'string' ? body : '');
  return {
    to: form.get('to') ?? '',
    topic: form.get('topic') ?? '',
    content: form.get('content') ?? '',
  };
}

export function zulipForms(calls: readonly FetchCall[]): ZulipForm[] {
  return calls
    .filter((call) => call.url.startsWith(zulipSite))
    .map((call) => zulipFormOf(call.body));
}

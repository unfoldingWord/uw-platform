import { z } from 'zod';
import type { Bindings } from '../env.ts';
import { httpsOrigin } from './origin.ts';
import { zulipConfigOf, type ZulipConfig } from './zulip/config.ts';

export type PushConfig = {
  readonly publicKey: string;
  readonly subject: string;
  readonly privateJwk: JsonWebKey;
};

export type NotifyConfig = {
  readonly appOrigin: string | null;
  readonly push: PushConfig | null;
  readonly zulip: ZulipConfig | null;
};

const publicKeyPattern = /^[A-Za-z0-9_-]{87}$/;
const privateJwkSchema = z.looseObject({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  d: z.string().min(1),
  x: z.string().min(1),
  y: z.string().min(1),
});

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function knownSubject(subject: string): boolean {
  return subject.startsWith('mailto:') || subject.startsWith('https://');
}

function bytesOf(text: string): Uint8Array | null {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function sameKey(publicKey: string, x: string, y: string): boolean {
  const point = bytesOf(publicKey);
  const xs = bytesOf(x);
  const ys = bytesOf(y);
  if (point === null || xs === null || ys === null) return false;
  if (xs.length !== 32 || ys.length !== 32 || point.length !== 65) return false;
  return [0x04, ...xs, ...ys].every((byte, index) => point.at(index) === byte);
}

function pushConfigOf(env: Bindings): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY ?? '';
  const subject = env.VAPID_SUBJECT ?? '';
  if (!publicKeyPattern.test(publicKey) || !knownSubject(subject)) return null;
  const jwk = privateJwkSchema.safeParse(parsedJson(env.VAPID_PRIVATE_JWK ?? ''));
  if (!jwk.success) return null;
  const { kty, crv, d, x, y } = jwk.data;
  if (!sameKey(publicKey, x, y)) return null;
  return { publicKey, subject, privateJwk: { kty, crv, d, x, y } };
}

export function notifyConfigOf(env: Bindings): NotifyConfig {
  return {
    appOrigin: httpsOrigin(env.APP_ORIGIN),
    push: pushConfigOf(env),
    zulip: zulipConfigOf(env),
  };
}

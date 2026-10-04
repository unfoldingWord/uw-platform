import { zulipOutgoingSchema, type IngestRefusal } from '@uw/contracts';
import type { VerifiedDelivery, WebhookSource } from '../env.ts';

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sameSecret(given: string, secret: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(given), digest(secret)]);
  let difference = 0;
  for (const [index, byte] of left.entries()) difference |= byte ^ (right.at(index) ?? 0);
  return difference === 0;
}

function parsed(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function tokenOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('token' in payload)) return null;
  return typeof payload.token === 'string' ? payload.token : null;
}

async function verifyZulip(
  _headers: Headers,
  rawBody: string,
  secret: string,
): Promise<VerifiedDelivery | IngestRefusal> {
  const payload = parsed(rawBody);
  if (payload === undefined) return 'malformed_delivery';
  const presented = tokenOf(payload);
  if (presented === null) return 'unsigned';
  if (!(await sameSecret(presented, secret))) return 'bad_signature';
  const outgoing = zulipOutgoingSchema.safeParse(payload);
  if (!outgoing.success) return 'malformed_delivery';
  return { deliveryId: `zulip:${outgoing.data.message.id}`, event: 'message' };
}

function withoutToken(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'token'));
}

export const zulipSource: WebhookSource = {
  secret: (env) => env.ZULIP_WEBHOOK_TOKEN,
  verify: verifyZulip,
  redact: withoutToken,
  accepted: { response_not_required: true },
};

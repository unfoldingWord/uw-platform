import { zulipOutgoingSchema, type IngestRefusal } from '@uw/contracts';
import type { BotTokens } from '../deliveries/bot-tokens.ts';
import type { BotTokenSource, VerifiedDelivery } from '../env.ts';
import { parsed, tokenOf, withoutToken } from './zulip.ts';

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function tokenDigestOf(token: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function sameDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyAssistant(
  rawBody: string,
  tokens: BotTokens,
): Promise<VerifiedDelivery | IngestRefusal> {
  const payload = parsed(rawBody);
  if (payload === undefined) return 'malformed_delivery';
  const presented = tokenOf(payload);
  if (presented === null) return 'unsigned';
  const outgoing = zulipOutgoingSchema.safeParse(payload);
  const botEmail = outgoing.success ? outgoing.data.bot_email : undefined;
  if (!outgoing.success || botEmail === undefined) return 'malformed_delivery';
  const known = await tokens.byBotEmail(botEmail);
  const digest = await tokenDigestOf(presented);
  if (known === null || !sameDigest(digest, known.digest)) return 'bad_signature';
  const messageId = String(outgoing.data.message.id);
  return {
    deliveryId: `zulip-assistant:${String(known.botUserId)}:${messageId}`,
    event: 'message',
  };
}

export const zulipAssistantSource: BotTokenSource = {
  verifyWith: verifyAssistant,
  redact: withoutToken,
  accepted: { response_not_required: true },
};

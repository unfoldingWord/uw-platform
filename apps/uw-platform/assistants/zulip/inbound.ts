import {
  zulipMessageSchema,
  type IngestEnvelope,
  type ZulipMessage,
  type ZulipRecipient,
} from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Executor } from '@uw/db/client';
import type { Caller, Kernel } from '@uw/harness';
import type { IngestHandler } from '../../queue/consumer.ts';
import type { TurnStarter } from '../turn/start.ts';
import { botByEmail, deliveryTarget, type BotRow } from './bots.ts';
import { codeDigestOf, pairingCodeIn } from './pairing-code.ts';
import { dmRequestOf } from './dm-parts.ts';

export type AssistantDmDeps = {
  readonly db: Executor;
  readonly kernel: Kernel;
  readonly now: () => Date;
  readonly startTurn: TurnStarter;
};

type Message = ZulipMessage['message'];
type Direct = {
  readonly envelope: IngestEnvelope;
  readonly message: Message;
  readonly bot: BotRow;
  readonly address: string;
  readonly logger: Logger;
};

const THREAD_KEY = 'dm';

function callerOf(envelope: IngestEnvelope): Caller {
  return { actor: envelope.principal, traceId: envelope.traceId, requestId: null };
}

function oneToOne(message: Message, botUserId: number): boolean {
  const recipients: readonly (string | ZulipRecipient)[] = Array.isArray(message.display_recipient)
    ? message.display_recipient
    : [];
  const ids = new Set(
    recipients.map((recipient) => (typeof recipient === 'string' ? 0 : recipient.id)),
  );
  return (
    message.sender_id !== undefined &&
    message.sender_id !== botUserId &&
    recipients.length === 2 &&
    ids.size === 2 &&
    ids.has(message.sender_id) &&
    ids.has(botUserId)
  );
}

function receivedAtOf(message: Message, now: () => Date): string {
  const seconds = message.timestamp;
  return (seconds === undefined ? now() : new Date(seconds * 1_000)).toISOString();
}

async function recordFrom(deps: AssistantDmDeps, direct: Direct): Promise<void> {
  const { envelope, message, bot, address, logger } = direct;
  const fenced = dmRequestOf(message.content);
  const recorded = await deps.kernel.assistants.recordRequest(callerOf(envelope), {
    personId: bot.personId,
    channel: 'zulip_dm',
    externalId: String(message.id),
    threadKey: THREAD_KEY,
    replyAddress: address,
    receivedAt: receivedAtOf(message, deps.now),
    note: fenced.note,
    untrustedParts: fenced.untrustedParts,
  });
  const fields = { delivery_id: envelope.deliveryId, harness_id: bot.harnessId };
  if (recorded.status === 'accepted') {
    const { requestId, created } = recorded.value;
    const outcome = created ? 'assistant_request_recorded' : 'assistant_request_replayed';
    logger.info('assistant request', { outcome, ...fields, request_id: requestId });
    const started = await deps.startTurn({ requestId, traceId: envelope.traceId });
    logger.info('assistant turn', { outcome: `assistant_turn_${started}`, ...fields });
    return;
  }
  logger.warn('assistant request refused', {
    outcome: recorded.reason,
    why: String(recorded.detail['why'] ?? ''),
    ...fields,
  });
}

async function pairFrom(deps: AssistantDmDeps, direct: Direct, code: string): Promise<void> {
  const { envelope, bot, address, logger } = direct;
  const paired = await deps.kernel.assistants.completePairing(callerOf(envelope), {
    personId: bot.personId,
    channel: 'zulip_dm',
    address,
    codeDigest: await codeDigestOf(code),
  });
  const fields = { delivery_id: envelope.deliveryId, harness_id: bot.harnessId };
  const outcome =
    paired.status === 'accepted'
      ? 'assistant_paired'
      : String(paired.detail['why'] ?? paired.reason);
  logger.info('assistant pairing', { outcome, ...fields });
}

async function fromBot(
  deps: AssistantDmDeps,
  envelope: IngestEnvelope,
  message: Message,
  bot: BotRow,
  logger: Logger,
): Promise<void> {
  const fields = { delivery_id: envelope.deliveryId, harness_id: bot.harnessId };
  if (!oneToOne(message, bot.botUserId)) {
    logger.info('assistant group conversation', { outcome: 'zulip_group_conversation', ...fields });
    return;
  }
  const address = `zulip:${String(message.sender_id)}`;
  const direct = { envelope, message, bot, address, logger };
  const target = await deliveryTarget(deps.db, bot.personId);
  if (target?.address === address) return recordFrom(deps, direct);
  const code = pairingCodeIn(message.content);
  if (code !== null) return pairFrom(deps, direct, code);
  logger.info('assistant sender unpaired', { outcome: 'zulip_sender_unpaired', ...fields });
}

export function assistantDmHandler(deps: AssistantDmDeps): IngestHandler {
  return async (envelope, logger) => {
    const delivery = { delivery_id: envelope.deliveryId };
    if (envelope.payloadTruncated || envelope.payload === null) {
      logger.warn('assistant delivery too large to queue', {
        outcome: 'payload_truncated',
        ...delivery,
      });
      return 'handled';
    }
    const parsed = zulipMessageSchema.safeParse(envelope.payload);
    if (!parsed.success) return 'malformed';
    const { message, bot_email: botEmail } = parsed.data;
    if (message.type !== 'private') {
      logger.info('assistant stream message ignored', { outcome: 'zulip_not_direct', ...delivery });
      return 'handled';
    }
    const bot = botEmail === undefined ? null : await botByEmail(deps.db, botEmail);
    if (bot === null || bot.status !== 'active') {
      logger.info('assistant bot unknown', { outcome: 'no_assistant', ...delivery });
      return 'handled';
    }
    await fromBot(deps, envelope, message, bot, logger);
    return 'handled';
  };
}

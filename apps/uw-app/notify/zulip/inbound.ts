import { zulipMessageSchema, type IngestEnvelope, type ZulipMessage } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Executor } from '@uw/db/client';
import type { Caller, Kernel } from '@uw/harness';
import { personByEmail } from '../../people/directory.ts';
import type { IngestHandler } from '../../queue/consumer.ts';
import type { ZulipConfig } from './config.ts';

export type ZulipIngestDeps = {
  readonly db: Executor;
  readonly kernel: Kernel;
  readonly config: ZulipConfig | null;
  readonly now: () => Date;
};

type Message = ZulipMessage['message'];

function callerOf(envelope: IngestEnvelope): Caller {
  return { actor: envelope.principal, traceId: envelope.traceId, requestId: null };
}

async function record(
  deps: ZulipIngestDeps,
  envelope: IngestEnvelope,
  message: Message,
  logger: Logger,
): Promise<void> {
  const caller = callerOf(envelope);
  const fields = { delivery_id: envelope.deliveryId, message_id: message.id };
  const target = await deps.kernel.reads.zulipTarget(caller, { topic: message.subject });
  if (target.status !== 'accepted') {
    logger.info('zulip topic unknown', { outcome: 'zulip_topic_unknown', ...fields });
    return;
  }
  const { harnessId, itemId, jdArea } = target.value;
  if (deps.config === null || deps.config.channels.get(jdArea) !== message.display_recipient) {
    logger.warn('zulip channel mismatch', { outcome: 'zulip_channel_mismatch', ...fields });
    return;
  }
  const person = await personByEmail(deps.db, message.sender_email);
  const recorded = await deps.kernel.items.recordComment(caller, {
    harnessId,
    itemId,
    messageId: message.id,
    topic: message.subject,
    personId: person?.personId ?? null,
    email: message.sender_email,
    text: message.content,
  });
  if (recorded.status === 'accepted') {
    logger.info('zulip reply recorded', {
      outcome: 'comment_recorded',
      ...fields,
      harness_id: harnessId,
    });
    return;
  }
  logger.warn('zulip reply refused', {
    outcome: recorded.reason,
    ...fields,
    harness_id: harnessId,
  });
}

export function zulipIngestHandler(deps: ZulipIngestDeps): IngestHandler {
  return async (envelope, logger) => {
    const delivery = { delivery_id: envelope.deliveryId };
    if (envelope.payloadTruncated || envelope.payload === null) {
      logger.warn('zulip delivery too large to queue', {
        outcome: 'payload_truncated',
        ...delivery,
      });
      return 'handled';
    }
    const parsed = zulipMessageSchema.safeParse(envelope.payload);
    if (!parsed.success) return 'malformed';
    const message = parsed.data.message;
    if (message.type === 'private') {
      logger.info('zulip private message ignored', {
        outcome: 'zulip_private_ignored',
        ...delivery,
      });
      return 'handled';
    }
    await record(deps, envelope, message, logger);
    return 'handled';
  };
}

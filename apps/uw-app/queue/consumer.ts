import { ingestEnvelopeSchema, type IngestEnvelope, type IngestSource } from '@uw/contracts';
import { createLogger, errorFields, type Logger, type LogSink } from '@uw/core/log';
import type { QueueProducer } from '../env.ts';

export const INGEST_QUEUE_KEY = 'ingest';

export const QUEUE_ROUTE = 'queue ingest';

export function batchTraceId(
  messages: readonly Pick<ConsumerMessage, 'body'>[],
  newId: () => string,
): string {
  for (const message of messages) {
    const parsed = ingestEnvelopeSchema.safeParse(message.body);
    if (parsed.success) return parsed.data.traceId;
  }
  return newId();
}

export type ConsumerMessage = {
  readonly body: unknown;
  readonly timestamp: Date;
  ack(): void;
  retry(): void;
};

type HandlerOutcome = 'handled' | 'malformed';

export type IngestHandler = (envelope: IngestEnvelope, logger: Logger) => Promise<HandlerOutcome>;

export type Watermarks = {
  record(queue: string, enqueuedAt: Date, consumedAt: Date): Promise<void>;
};

export type ConsumerDeps = {
  readonly handlers: ReadonlyMap<IngestSource, IngestHandler>;
  readonly deadLetter: QueueProducer<unknown> | null;
  readonly watermarks: Watermarks | null;
  readonly sink: LogSink;
  readonly commit: string;
  readonly newId: () => string;
  readonly now: () => Date;
};

export const notWiredHandlers: ReadonlyMap<IngestSource, IngestHandler> = new Map<
  IngestSource,
  IngestHandler
>([
  [
    'github',
    async (envelope, logger) => {
      logger.info('github delivery received', {
        outcome: 'not_wired',
        event: envelope.event,
        delivery_id: envelope.deliveryId,
      });
      return 'handled';
    },
  ],
  [
    'zulip',
    async (envelope, logger) => {
      logger.info('zulip delivery received', {
        outcome: 'not_wired',
        event: envelope.event,
        delivery_id: envelope.deliveryId,
      });
      return 'handled';
    },
  ],
]);

function unattributedLogger(deps: ConsumerDeps): Logger {
  return createLogger(
    { traceId: deps.newId(), commit: deps.commit, route: QUEUE_ROUTE, principal: null },
    deps.sink,
  );
}

type Malformed = 'malformed_envelope' | 'malformed_payload';

async function deadLetter(
  message: ConsumerMessage,
  deps: ConsumerDeps,
  logger: Logger,
  reason: Malformed,
): Promise<void> {
  if (!deps.deadLetter) {
    message.retry();
    logger.error(`${reason.replace('_', ' ')}, retrying`, { outcome: reason });
    return;
  }
  try {
    await deps.deadLetter.send({ reason, body: message.body });
  } catch (error) {
    message.retry();
    logger.error('dead-letter send failed, retrying', {
      outcome: 'dead_letter_failed',
      ...errorFields(error),
    });
    return;
  }
  message.ack();
  logger.warn(`${reason.replace('_', ' ')} sent to the dead-letter queue`, { outcome: reason });
}

async function handle(
  message: ConsumerMessage,
  envelope: IngestEnvelope,
  handler: IngestHandler,
  logger: Logger,
): Promise<HandlerOutcome | null> {
  let outcome: HandlerOutcome;
  try {
    outcome = await handler(envelope, logger);
  } catch (error) {
    message.retry();
    logger.error('handler failed, retrying', {
      outcome: 'handler_failed',
      ...errorFields(error),
      event: envelope.event,
      delivery_id: envelope.deliveryId,
    });
    return null;
  }
  if (outcome === 'handled') message.ack();
  return outcome;
}

async function consumeOne(
  message: ConsumerMessage,
  seen: Set<string>,
  deps: ConsumerDeps,
): Promise<void> {
  const parsed = ingestEnvelopeSchema.safeParse(message.body);
  const handler = parsed.success ? deps.handlers.get(parsed.data.source) : undefined;
  if (!parsed.success || !handler) {
    return deadLetter(message, deps, unattributedLogger(deps), 'malformed_envelope');
  }
  const envelope = parsed.data;
  const logger = createLogger(
    {
      traceId: envelope.traceId,
      commit: deps.commit,
      route: QUEUE_ROUTE,
      principal: envelope.principal.identity,
    },
    deps.sink,
  );
  const key = `${envelope.source}:${envelope.deliveryId}`;
  if (seen.has(key)) {
    message.ack();
    logger.info('duplicate delivery in batch', {
      outcome: 'duplicate',
      delivery_id: envelope.deliveryId,
    });
    return;
  }
  seen.add(key);
  const outcome = await handle(message, envelope, handler, logger);
  if (outcome === 'malformed') await deadLetter(message, deps, logger, 'malformed_payload');
}

async function recordLag(messages: readonly ConsumerMessage[], deps: ConsumerDeps): Promise<void> {
  if (!deps.watermarks || messages.length === 0) return;
  const latest = new Date(Math.max(...messages.map((message) => message.timestamp.getTime())));
  try {
    await deps.watermarks.record(INGEST_QUEUE_KEY, latest, deps.now());
  } catch (error) {
    unattributedLogger(deps).warn('queue watermark not recorded', {
      outcome: 'watermark_failed',
      ...errorFields(error),
    });
  }
}

export async function consumeBatch(
  messages: readonly ConsumerMessage[],
  deps: ConsumerDeps,
): Promise<void> {
  const seen = new Set<string>();
  for (const message of messages) {
    await consumeOne(message, seen, deps);
  }
  await recordLag(messages, deps);
}

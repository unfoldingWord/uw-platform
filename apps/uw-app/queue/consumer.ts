import { ingestEnvelopeSchema, type IngestEnvelope, type IngestSource } from '@uw/contracts';
import { createLogger, type Logger, type LogSink } from '@uw/core/log';
import type { QueueProducer } from '../env.ts';

export const INGEST_QUEUE_KEY = 'ingest';

const QUEUE_ROUTE = 'queue ingest';

export type ConsumerMessage = {
  readonly body: unknown;
  readonly timestamp: Date;
  ack(): void;
  retry(): void;
};

export type IngestHandler = (envelope: IngestEnvelope, logger: Logger) => Promise<void>;

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

export const ingestHandlers: ReadonlyMap<IngestSource, IngestHandler> = new Map<
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
    },
  ],
]);

function unattributedLogger(deps: ConsumerDeps): Logger {
  return createLogger(
    { traceId: deps.newId(), commit: deps.commit, route: QUEUE_ROUTE, principal: null },
    deps.sink,
  );
}

async function refuseMalformed(message: ConsumerMessage, deps: ConsumerDeps): Promise<void> {
  const logger = unattributedLogger(deps);
  if (!deps.deadLetter) {
    message.retry();
    logger.error('malformed envelope, retrying', { outcome: 'malformed_envelope' });
    return;
  }
  try {
    await deps.deadLetter.send({ reason: 'malformed_envelope', body: message.body });
  } catch {
    message.retry();
    logger.error('dead-letter send failed, retrying', { outcome: 'dead_letter_failed' });
    return;
  }
  message.ack();
  logger.warn('malformed envelope sent to the dead-letter queue', {
    outcome: 'malformed_envelope',
  });
}

async function handle(
  message: ConsumerMessage,
  envelope: IngestEnvelope,
  handler: IngestHandler,
  logger: Logger,
): Promise<void> {
  try {
    await handler(envelope, logger);
  } catch {
    message.retry();
    logger.error('handler failed, retrying', {
      outcome: 'handler_failed',
      event: envelope.event,
      delivery_id: envelope.deliveryId,
    });
    return;
  }
  message.ack();
}

async function consumeOne(
  message: ConsumerMessage,
  seen: Set<string>,
  deps: ConsumerDeps,
): Promise<void> {
  const parsed = ingestEnvelopeSchema.safeParse(message.body);
  const handler = parsed.success ? deps.handlers.get(parsed.data.source) : undefined;
  if (!parsed.success || !handler) return refuseMalformed(message, deps);
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
  await handle(message, envelope, handler, logger);
}

async function recordLag(messages: readonly ConsumerMessage[], deps: ConsumerDeps): Promise<void> {
  if (!deps.watermarks || messages.length === 0) return;
  const latest = new Date(Math.max(...messages.map((message) => message.timestamp.getTime())));
  try {
    await deps.watermarks.record(INGEST_QUEUE_KEY, latest, deps.now());
  } catch {
    unattributedLogger(deps).warn('queue watermark not recorded', {
      outcome: 'watermark_failed',
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

import { describe, expect, it } from 'vitest';
import { ingestEnvelopeSchema, type IngestEnvelope } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import {
  batchTraceId,
  consumeBatch,
  INGEST_QUEUE_KEY,
  notWiredHandlers,
  type ConsumerDeps,
  type ConsumerMessage,
  type IngestHandler,
} from './consumer.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const NOW = new Date('2026-10-01T12:05:00.000Z');

const validEnvelope: IngestEnvelope = ingestEnvelopeSchema.parse({
  envelopeVersion: 1,
  traceId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  source: 'github',
  deliveryId: 'd-1',
  event: 'push',
  receivedAt: '2026-10-01T12:00:00.000Z',
  principal: {
    identity: 'agent:ingest',
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  },
  payload: { ref: 'refs/heads/main' },
  payloadTruncated: false,
});

type FakeMessage = ConsumerMessage & { acked: boolean; retried: boolean };

function fakeMessage(body: unknown, timestamp = new Date('2026-10-01T12:00:01.000Z')): FakeMessage {
  const message: FakeMessage = {
    body,
    timestamp,
    acked: false,
    retried: false,
    ack: () => {
      message.acked = true;
    },
    retry: () => {
      message.retried = true;
    },
  };
  return message;
}

type Harness = {
  readonly deps: ConsumerDeps;
  readonly lines: Record<string, unknown>[];
  readonly deadLettered: unknown[];
  readonly handled: IngestEnvelope[];
  readonly recorded: [string, Date, Date][];
};

type HarnessOptions = {
  readonly handler?: IngestHandler;
  readonly withDeadLetter?: boolean;
  readonly watermarkFails?: boolean;
};

function harness(options: HarnessOptions = {}): Harness {
  const lines: Record<string, unknown>[] = [];
  const deadLettered: unknown[] = [];
  const handled: IngestEnvelope[] = [];
  const recorded: [string, Date, Date][] = [];
  const handler: IngestHandler =
    options.handler ??
    (async (envelope, logger) => {
      handled.push(envelope);
      logger.info('handled', { outcome: 'handled' });
      return 'handled';
    });
  const deps: ConsumerDeps = {
    handlers: new Map([['github', handler]]),
    deadLetter:
      options.withDeadLetter === false
        ? null
        : {
            send: async (body) => {
              deadLettered.push(body);
            },
          },
    watermarks: {
      record: async (queue, enqueuedAt, consumedAt) => {
        if (options.watermarkFails) throw new Error('watermark store down');
        recorded.push([queue, enqueuedAt, consumedAt]);
      },
    },
    sink: (line) => lines.push(JSON.parse(line)),
    commit: COMMIT,
    newId: () => 'fresh-trace-id',
    now: () => NOW,
  };
  return { deps, lines, deadLettered, handled, recorded };
}

function outcomes(h: Harness): unknown[] {
  return h.lines.map((line) => line['outcome']);
}

describe('FD-10 the ingest consumer', () => {
  it('hands a valid envelope to its handler and acks it', async () => {
    const h = harness();
    const message = fakeMessage(validEnvelope);
    await consumeBatch([message], h.deps);
    expect(h.handled).toEqual([validEnvelope]);
    expect(message.acked).toBe(true);
    expect(message.retried).toBe(false);
  });

  it('sends a malformed message to the dead-letter queue and acks it', async () => {
    const h = harness();
    const body = { not: 'an envelope' };
    const message = fakeMessage(body);
    await consumeBatch([message], h.deps);
    expect(h.deadLettered).toEqual([{ reason: 'malformed_envelope', body }]);
    expect(message.acked).toBe(true);
    expect(message.retried).toBe(false);
    expect(h.handled).toHaveLength(0);
    expect(outcomes(h)).toContain('malformed_envelope');
  });

  it('retries a malformed message when no dead-letter producer is bound', async () => {
    const h = harness({ withDeadLetter: false });
    const message = fakeMessage({ not: 'an envelope' });
    await consumeBatch([message], h.deps);
    expect(message.retried).toBe(true);
    expect(message.acked).toBe(false);
    expect(h.lines).toContainEqual(
      expect.objectContaining({ level: 'error', outcome: 'malformed_envelope' }),
    );
  });
});

describe('FD-10 the ingest consumer when the dead-letter queue fails', () => {
  it('retries a message when the dead-letter send fails', async () => {
    const h = harness();
    const failing: ConsumerDeps = {
      ...h.deps,
      deadLetter: {
        send: async () => {
          throw new Error('dead-letter queue down');
        },
      },
    };
    const message = fakeMessage({ not: 'an envelope' });
    await consumeBatch([message], failing);
    expect(message.retried).toBe(true);
    expect(message.acked).toBe(false);
    expect(h.lines).toContainEqual(
      expect.objectContaining({
        outcome: 'dead_letter_failed',
        error_name: 'Error',
        error_message: 'dead-letter queue down',
      }),
    );
  });
});

describe('FD-10 the ingest consumer and a malformed payload', () => {
  it('sends a delivery its handler finds malformed to the dead-letter queue and acks it', async () => {
    const h = harness({ handler: async () => 'malformed' });
    const message = fakeMessage(validEnvelope);
    await consumeBatch([message], h.deps);
    expect(h.deadLettered).toEqual([{ reason: 'malformed_payload', body: validEnvelope }]);
    expect(message.acked).toBe(true);
    expect(message.retried).toBe(false);
    expect(h.lines).toContainEqual(
      expect.objectContaining({ trace_id: validEnvelope.traceId, outcome: 'malformed_payload' }),
    );
  });

  it('retries a delivery its handler finds malformed when no dead-letter producer is bound', async () => {
    const h = harness({ handler: async () => 'malformed', withDeadLetter: false });
    const message = fakeMessage(validEnvelope);
    await consumeBatch([message], h.deps);
    expect(message.retried).toBe(true);
    expect(message.acked).toBe(false);
    expect(h.lines).toContainEqual(
      expect.objectContaining({ level: 'error', outcome: 'malformed_payload' }),
    );
  });
});

describe('FD-10 the ingest consumer duplicates and failures', () => {
  it('tolerates a duplicate delivery within a batch', async () => {
    const h = harness();
    const first = fakeMessage(validEnvelope);
    const second = fakeMessage(validEnvelope);
    await consumeBatch([first, second], h.deps);
    expect(h.handled).toHaveLength(1);
    expect(first.acked).toBe(true);
    expect(second.acked).toBe(true);
    expect(outcomes(h)).toContain('duplicate');
  });

  it('retries a message whose handler throws', async () => {
    const h = harness({
      handler: async () => {
        throw new Error('handler down');
      },
    });
    const message = fakeMessage(validEnvelope);
    await consumeBatch([message], h.deps);
    expect(message.retried).toBe(true);
    expect(message.acked).toBe(false);
    expect(h.lines).toContainEqual(
      expect.objectContaining({
        outcome: 'handler_failed',
        error_name: 'Error',
        error_message: 'handler down',
      }),
    );
  });

  it('treats a source with no handler as malformed', async () => {
    const h = harness();
    const bare: ConsumerDeps = { ...h.deps, handlers: new Map() };
    const message = fakeMessage(validEnvelope);
    await consumeBatch([message], bare);
    expect(h.deadLettered).toEqual([{ reason: 'malformed_envelope', body: validEnvelope }]);
    expect(message.acked).toBe(true);
  });
});

describe('FD-11 the ingest consumer logs and lag', () => {
  it('logs under the envelope trace id and the ingest identity', async () => {
    const h = harness();
    await consumeBatch([fakeMessage(validEnvelope)], h.deps);
    const accepted = h.lines.filter((l) => l['trace_id'] === validEnvelope.traceId);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.every((l) => l['principal'] === 'agent:ingest')).toBe(true);
    expect(accepted.every((l) => l['route'] === 'queue ingest')).toBe(true);
    expect(accepted.every((l) => l['commit'] === COMMIT)).toBe(true);
  });

  it('logs a malformed message under a fresh trace id', async () => {
    const h = harness();
    await consumeBatch([fakeMessage({ not: 'an envelope' })], h.deps);
    expect(h.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        trace_id: 'fresh-trace-id',
        outcome: 'malformed_envelope',
      }),
    );
  });
});

describe('FD-11 the ingest consumer lag', () => {
  it('records the latest enqueue time of the batch once', async () => {
    const h = harness();
    const t1 = new Date('2026-10-01T12:00:01.000Z');
    const t2 = new Date('2026-10-01T12:00:09.000Z');
    const t3 = new Date('2026-10-01T12:00:05.000Z');
    const batch = [
      fakeMessage({ ...validEnvelope, deliveryId: 'a' }, t1),
      fakeMessage({ ...validEnvelope, deliveryId: 'b' }, t2),
      fakeMessage({ ...validEnvelope, deliveryId: 'c' }, t3),
    ];
    await consumeBatch(batch, h.deps);
    expect(h.recorded).toEqual([[INGEST_QUEUE_KEY, t2, NOW]]);
  });

  it('records nothing for an empty batch', async () => {
    const h = harness();
    await consumeBatch([], h.deps);
    expect(h.recorded).toHaveLength(0);
  });

  it('acks every message and logs a warning when the watermark write fails', async () => {
    const h = harness({ watermarkFails: true });
    const batch = [
      fakeMessage({ ...validEnvelope, deliveryId: 'a' }),
      fakeMessage({ ...validEnvelope, deliveryId: 'b' }),
    ];
    await consumeBatch(batch, h.deps);
    expect(batch.every((message) => message.acked)).toBe(true);
    expect(h.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        outcome: 'watermark_failed',
        error_name: 'Error',
        error_message: 'watermark store down',
      }),
    );
  });
});

describe('FD-10 the github handler', () => {
  it('treats the queued principal as a record, not an authority: it logs and reads no grants', async () => {
    const lines: Record<string, unknown>[] = [];
    const handler = notWiredHandlers.get('github');
    const staleAdmin = {
      ...validEnvelope,
      principal: {
        ...validEnvelope.principal,
        grants: [
          {
            grantId: '7d9f0c1e-8c53-4a53-9d6e-0a9b6a0f4d12',
            role: 'admin' as const,
            scopeKind: 'org' as const,
            scopeArea: null,
            expiresAt: null,
          },
        ],
      },
    };
    const logger = createLogger(
      {
        traceId: staleAdmin.traceId,
        commit: COMMIT,
        route: 'queue ingest',
        principal: 'agent:ingest',
      },
      (line) => lines.push(JSON.parse(line)),
    );
    await handler?.(staleAdmin, logger);
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'github delivery received',
        outcome: 'not_wired',
        event: 'push',
        delivery_id: 'd-1',
      }),
    ]);
  });
});

describe('the handlers before the database is configured', () => {
  it('log a Zulip delivery as not wired and handle it', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger(
      { traceId: validEnvelope.traceId, commit: COMMIT, route: 'queue ingest', principal: null },
      (line) => lines.push(JSON.parse(line)),
    );
    const zulip = { ...validEnvelope, source: 'zulip' as const, event: 'message' };
    expect(await notWiredHandlers.get('zulip')?.(zulip, logger)).toBe('handled');
    expect(lines).toEqual([expect.objectContaining({ outcome: 'not_wired', event: 'message' })]);
  });
});

describe('the trace id of a queue batch', () => {
  it('is the trace id of the first well-formed envelope in the batch', () => {
    const second = { ...validEnvelope, traceId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d12' };
    const messages = [
      fakeMessage({ not: 'an envelope' }),
      fakeMessage(validEnvelope),
      fakeMessage(second),
    ];
    expect(batchTraceId(messages, () => 'minted')).toBe(validEnvelope.traceId);
  });

  it('is a minted id when no envelope in the batch is well formed', () => {
    expect(batchTraceId([fakeMessage({ not: 'an envelope' })], () => 'minted')).toBe('minted');
  });
});

import { describe, expect, it } from 'vitest';
import worker from './index.ts';

type Spy = { acked: boolean; sent: unknown[] };

function malformedBatch(spy: Spy) {
  const message = {
    id: 'm1',
    attempts: 1,
    body: { not: 'an envelope' },
    timestamp: new Date('2026-10-01T12:00:00.000Z'),
    ack: () => {
      spy.acked = true;
    },
    retry: () => undefined,
  };
  return {
    queue: 'ingest',
    messages: [message],
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll: () => undefined,
    ackAll: () => undefined,
  };
}

describe('FD-10 the uw-app worker entry', () => {
  it('exports a fetch handler and a queue handler', () => {
    expect(typeof worker.fetch).toBe('function');
    expect(typeof worker.queue).toBe('function');
  });

  it('routes a malformed queue message to the bound dead-letter queue', async () => {
    const spy: Spy = { acked: false, sent: [] };
    const deadLetter = {
      send: async (body: unknown) => {
        spy.sent.push(body);
      },
    };
    await worker.queue(malformedBatch(spy), { INGEST_DLQ: deadLetter });
    expect(spy.acked).toBe(true);
    expect(spy.sent).toEqual([{ reason: 'malformed_envelope', body: { not: 'an envelope' } }]);
  });
});

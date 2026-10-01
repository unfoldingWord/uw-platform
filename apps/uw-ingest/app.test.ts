import { sign } from '@octokit/webhooks-methods';
import { describe, expect, it } from 'vitest';
import { ingestEnvelopeSchema } from '@uw/contracts';
import fixture from './fixtures/github/pull_request.opened.json' with { type: 'json' };
import { envelopesIn, FIXED_NOW, FIXTURE_SECRET, harness, post } from './testing/deliver.ts';

const body = JSON.stringify(fixture);

async function refusal(response: Response) {
  return { status: response.status, json: await response.json() };
}

describe('FD-10 an accepted delivery', () => {
  it('enqueues one envelope carrying the ingest identity and the trace id', async () => {
    const h = harness();
    const response = await post(h, { body });
    expect(await refusal(response)).toEqual({ status: 202, json: { status: 'accepted' } });
    const [envelope] = envelopesIn(h);
    expect(h.queue.sent).toHaveLength(1);
    expect(envelope).toMatchObject({
      deliveryId: 'd-1',
      event: 'pull_request',
      source: 'github',
      payloadTruncated: false,
      receivedAt: FIXED_NOW,
      payload: fixture,
    });
    expect(envelope?.principal.identity).toBe('agent:ingest');
    expect(ingestEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope?.traceId).toBe(response.headers.get('x-trace-id'));
    expect(h.queue.options).toEqual([{ contentType: 'json' }]);
    expect(h.lines[0]).toMatchObject({
      trace_id: envelope?.traceId,
      route: 'POST /webhooks/:source',
      principal: 'agent:ingest',
      outcome: 'accepted',
      level: 'info',
    });
  });
});

describe('FD-10 refused deliveries', () => {
  async function expectRefused(
    delivery: Parameters<typeof post>[1],
    status: number,
    reason: string,
  ) {
    const h = harness();
    const response = await post(h, delivery);
    expect(await refusal(response)).toEqual({ status, json: { status: 'error', reason } });
    expect(h.queue.sent).toHaveLength(0);
    expect(h.ledger.keys.size).toBe(0);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ level: 'warn', outcome: reason, principal: 'agent:ingest' });
    expect(response.headers.get('x-trace-id')).toBe(h.lines[0]?.['trace_id']);
    return h;
  }

  it('refuses a delivery with no signature', () =>
    expectRefused({ body, signature: null }, 401, 'unsigned'));

  it('refuses a signature made with another secret', () =>
    expectRefused({ body, secret: 'another-secret' }, 401, 'bad_signature'));

  it('refuses a body changed by one byte after signing', async () => {
    const signature = await sign(FIXTURE_SECRET, body);
    await expectRefused({ body: `${body} `, signature }, 401, 'bad_signature');
  });

  it('refuses a signed body that is not JSON', () =>
    expectRefused({ body: 'not json' }, 400, 'malformed_payload'));

  it('refuses a signed delivery with no delivery id', () =>
    expectRefused({ body, deliveryId: null }, 400, 'malformed_delivery'));

  it('refuses an unknown source', () =>
    expectRefused({ body, path: '/webhooks/stripe' }, 404, 'unknown_source'));

  it('refuses a signed delivery with no event header', () =>
    expectRefused({ body, event: null }, 400, 'malformed_delivery'));

  it('refuses a delivery id the envelope cannot carry', () =>
    expectRefused({ body, deliveryId: 'd'.repeat(201) }, 400, 'malformed_delivery'));

  it('refuses a body declared larger than 25 MB before reading it', () =>
    expectRefused({ body, contentLength: 25 * 1024 * 1024 + 1 }, 413, 'payload_too_large'));
});

describe('FD-10 replay detection', () => {
  it('accepts a delivery once and refuses its replay', async () => {
    const h = harness();
    const first = await post(h, { body });
    const second = await post(h, { body });
    expect(first.status).toBe(202);
    expect(await refusal(second)).toEqual({
      status: 409,
      json: { status: 'error', reason: 'replayed' },
    });
    expect(h.queue.sent).toHaveLength(1);
  });

  it('releases the record when the queue send fails, so a redelivery is accepted', async () => {
    const h = harness();
    h.queue.failNext();
    const failed = await post(h, { body });
    expect(await refusal(failed)).toEqual({
      status: 503,
      json: { status: 'error', reason: 'enqueue_failed' },
    });
    expect(h.ledger.keys.size).toBe(0);
    const redelivered = await post(h, { body });
    expect(redelivered.status).toBe(202);
    expect(h.queue.sent).toHaveLength(1);
  });
});

describe('FD-10 missing configuration', () => {
  it('refuses with source_not_configured when the secret is absent', async () => {
    const h = harness();
    const response = await post(h, { body }, { INGEST_QUEUE: h.queue });
    expect(await refusal(response)).toEqual({
      status: 503,
      json: { status: 'error', reason: 'source_not_configured' },
    });
    expect(h.queue.sent).toHaveLength(0);
    expect(h.ledger.keys.size).toBe(0);
  });

  it('refuses with replay_store_not_configured when there is no ledger', async () => {
    const h = harness({ openLedger: () => null });
    const response = await post(h, { body });
    expect(await refusal(response)).toEqual({
      status: 503,
      json: { status: 'error', reason: 'replay_store_not_configured' },
    });
    expect(h.queue.sent).toHaveLength(0);
  });

  it('refuses with queue_not_configured and leaves the ledger empty', async () => {
    const h = harness();
    const response = await post(h, { body }, { GITHUB_WEBHOOK_SECRET: FIXTURE_SECRET });
    expect(await refusal(response)).toEqual({
      status: 503,
      json: { status: 'error', reason: 'queue_not_configured' },
    });
    expect(h.ledger.keys.size).toBe(0);
  });
});

describe('FD-10 oversized deliveries', () => {
  it('sends a delivery larger than the queue limit with a null payload, flagged truncated', async () => {
    const h = harness();
    const large = JSON.stringify({ action: 'opened', text: 'x'.repeat(130_000) });
    const response = await post(h, { body: large });
    expect(response.status).toBe(202);
    const [envelope] = envelopesIn(h);
    expect(envelope).toMatchObject({ payload: null, payloadTruncated: true });
  });
});

describe('FD-11 health and logging', () => {
  it('reports the deployed commit as a health report', async () => {
    const h = harness();
    const response = await h.app.request('/health', {}, h.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      commit: 'abc1234',
      indicators: [{ name: 'commit', status: 'ok', detail: 'abc1234' }],
    });
  });

  it('writes no log line that contains the body', async () => {
    const h = harness();
    const marker = 'body-marker-0f3a';
    await post(h, { body: JSON.stringify({ marker }) });
    await post(h, { body: `not json ${marker}` });
    await post(h, { body: JSON.stringify({ marker }), signature: null });
    expect(h.rawLines.length).toBeGreaterThan(0);
    expect(h.rawLines.some((line) => line.includes(marker))).toBe(false);
  });
});

describe('FD-11 an unexpected failure is diagnosable from the log alone', () => {
  const marker = 'ledger-open-marker-91d4';

  async function failingPost() {
    const h = harness({
      openLedger: () => {
        throw new RangeError(marker);
      },
    });
    const response = await post(h, { body });
    return { h, response };
  }

  it('logs the error name and message on the request-failed line', async () => {
    const { h } = await failingPost();
    expect(h.lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'request failed',
        error_name: 'RangeError',
        error_message: marker,
      }),
    );
  });

  it('never puts the error in the response', async () => {
    const { response } = await failingPost();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(marker);
  });
});

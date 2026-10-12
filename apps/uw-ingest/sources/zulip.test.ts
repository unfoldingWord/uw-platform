import { describe, expect, it } from 'vitest';
import mention from '../fixtures/zulip/outgoing-mention.json' with { type: 'json' };
import { envelopesIn, harness } from '../testing/deliver.ts';
import { zulipSource } from './zulip.ts';

const TOKEN = 'fixture-zulip-token';
const body = JSON.stringify(mention);

function deliver(h: ReturnType<typeof harness>, raw: string, token: string | null = TOKEN) {
  const env = { ...h.env, ...(token === null ? {} : { ZULIP_WEBHOOK_TOKEN: token }) };
  return h.app.request(
    '/webhooks/zulip',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw },
    env,
  );
}

async function answer(response: Response) {
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe('the Zulip webhook source', () => {
  it('NT-3 an inbound Zulip webhook is accepted only with the bot token and enqueued without it', async () => {
    const h = harness();
    const accepted = await answer(await deliver(h, body));
    expect(accepted.status).toBe(202);
    expect(accepted.json['status']).toBe('accepted');
    expect(accepted.json).not.toHaveProperty('content');
    const [envelope] = envelopesIn(h);
    expect(envelope).toMatchObject({ source: 'zulip', deliveryId: 'zulip:112', event: 'message' });
    expect(envelope?.payload).not.toHaveProperty('token');
    expect(JSON.stringify(h.queue.sent)).not.toContain(TOKEN);
    expect(envelope?.payload).toMatchObject({
      message: { id: 112, subject: 'software/uw-platform#42' },
    });
    expect(await answer(await deliver(h, body))).toEqual({
      status: 409,
      json: { status: 'error', reason: 'replayed' },
    });
  });

  it('refuses a wrong token, a missing token and an unconfigured source', async () => {
    const wrong = JSON.stringify({ ...mention, token: 'not-the-token' });
    const unsigned = Object.fromEntries(Object.entries(mention).filter(([key]) => key !== 'token'));
    const cases: [string, string | null, number, string][] = [
      [wrong, TOKEN, 401, 'bad_signature'],
      [JSON.stringify(unsigned), TOKEN, 401, 'unsigned'],
      [body, null, 503, 'source_not_configured'],
      ['not json', TOKEN, 400, 'malformed_delivery'],
    ];
    for (const [raw, token, status, reason] of cases) {
      const h = harness();
      expect(await answer(await deliver(h, raw, token))).toEqual({
        status,
        json: { status: 'error', reason },
      });
      expect(h.queue.sent).toHaveLength(0);
    }
  });

  it('compares the token through a digest and strips it from the payload', async () => {
    expect(await zulipSource.verify(new Headers(), body, TOKEN)).toEqual({
      deliveryId: 'zulip:112',
      event: 'message',
    });
    expect(await zulipSource.verify(new Headers(), body, `${TOKEN}x`)).toBe('bad_signature');
    expect(zulipSource.redact?.(mention)).not.toHaveProperty('token');
    expect(zulipSource.redact?.(mention)).toHaveProperty('message');
  });
});

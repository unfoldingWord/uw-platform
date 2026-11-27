import { describe, expect, it } from 'vitest';
import direct from '../fixtures/zulip/assistant-direct.json' with { type: 'json' };
import type { BotTokens } from '../deliveries/bot-tokens.ts';
import { envelopesIn, harness } from '../testing/deliver.ts';
import { tokenDigestOf } from './zulip-assistant.ts';

const TOKEN = 'barnabas-webhook-token';

async function memoryTokens(): Promise<BotTokens & { readonly asked: string[] }> {
  const asked: string[] = [];
  const digest = await tokenDigestOf(TOKEN);
  return {
    asked,
    byBotEmail: async (botEmail) => {
      asked.push(botEmail);
      return botEmail === 'barnabas-bot@chat.example.org' ? { botUserId: 9001, digest } : null;
    },
  };
}

async function deliver(raw: string, tokens: BotTokens | null) {
  const h = harness();
  const ledger = h.ledger;
  const withTokens = harness({
    openLedger: () =>
      tokens === null
        ? { ledger, release: async () => undefined }
        : { ledger, botTokens: tokens, release: async () => undefined },
  });
  const response = await withTokens.app.request(
    '/webhooks/zulip-assistant',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw },
    withTokens.env,
  );
  return { h: withTokens, status: response.status, json: (await response.json()) as unknown };
}

describe('PA-6 the per-bot Zulip assistant webhook source', () => {
  it('accepts a delivery only with its own bot token, keyed by bot and message, without the token', async () => {
    const tokens = await memoryTokens();
    const { h, status } = await deliver(JSON.stringify(direct), tokens);
    expect(status).toBe(202);
    const [envelope] = envelopesIn(h);
    expect(envelope).toMatchObject({
      source: 'zulip-assistant',
      deliveryId: 'zulip-assistant:9001:7001',
      event: 'message',
    });
    expect(envelope?.payload).not.toHaveProperty('token');
    expect(JSON.stringify(h.queue.sent)).not.toContain(TOKEN);
    expect(tokens.asked).toEqual(['barnabas-bot@chat.example.org']);
  });

  it('refuses another bot token, an unknown bot and a missing token', async () => {
    const tokens = await memoryTokens();
    const wrong = await deliver(JSON.stringify({ ...direct, token: 'another' }), tokens);
    expect([wrong.status, wrong.json]).toEqual([401, { status: 'error', reason: 'bad_signature' }]);
    const unknown = { ...direct, bot_email: 'silas-bot@chat.example.org' };
    expect((await deliver(JSON.stringify(unknown), tokens)).status).toBe(401);
    const unsigned = Object.fromEntries(Object.entries(direct).filter(([key]) => key !== 'token'));
    const missing = await deliver(JSON.stringify(unsigned), tokens);
    expect([missing.status, missing.json]).toEqual([401, { status: 'error', reason: 'unsigned' }]);
  });

  it('refuses a delivery that names no bot, and one when no token store is reachable', async () => {
    const tokens = await memoryTokens();
    const nameless = Object.fromEntries(
      Object.entries(direct).filter(([key]) => key !== 'bot_email'),
    );
    const unnamed = await deliver(JSON.stringify(nameless), tokens);
    expect([unnamed.status, unnamed.json]).toEqual([
      400,
      { status: 'error', reason: 'malformed_delivery' },
    ]);
    const unreachable = await deliver(JSON.stringify(direct), null);
    expect(unreachable.status).toBe(503);
  });
});

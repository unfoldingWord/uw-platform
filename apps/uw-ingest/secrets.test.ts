import { describe, expect, it } from 'vitest';
import { storedSecret, unreadableSecret } from '@uw/core/platform-secrets-testing';
import fixture from './fixtures/github/pull_request.opened.json' with { type: 'json' };
import worker from './index.ts';
import { ingestSecretNames, withSecrets } from './secrets.ts';
import { harness, post } from './testing/deliver.ts';

const body = JSON.stringify(fixture);
const context = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

async function health(env: Parameters<typeof worker.fetch>[1]) {
  const request = new Request('https://uw-ingest.test/health');
  const response = await worker.fetch(request, env, context);
  return (await response.json()) as {
    readonly status: string;
    readonly indicators: readonly { readonly name: string; readonly detail: string }[];
  };
}

describe('#160 uw-ingest reads its two secrets through the same seam', () => {
  it('binds only the secrets uw-ingest verifies deliveries with', () => {
    expect([...ingestSecretNames]).toEqual(['GITHUB_WEBHOOK_SECRET', 'ZULIP_WEBHOOK_TOKEN']);
  });

  it('verifies a GitHub delivery against a webhook secret bound from the Secrets Store', async () => {
    const h = harness();
    const env = await withSecrets({
      INGEST_QUEUE: h.queue,
      STORE_GITHUB_WEBHOOK_SECRET: storedSecret('store-webhook-secret'),
    });
    const accepted = await post(h, { body, secret: 'store-webhook-secret' }, env);
    const refused = await post(h, { body, secret: 'another-secret', deliveryId: 'd-2' }, env);
    expect([accepted.status, refused.status]).toEqual([202, 401]);
  });

  it('says on health how many secrets came from each source, without a name or a value', async () => {
    const report = await health({
      COMMIT_SHA: 'abc1234',
      ZULIP_WEBHOOK_TOKEN: 'legacy-zulip-token',
      STORE_GITHUB_WEBHOOK_SECRET: storedSecret('store-webhook-secret'),
    });
    expect(report).toEqual({
      status: 'ok',
      commit: 'abc1234',
      indicators: [
        { name: 'commit', status: 'ok', detail: 'abc1234' },
        {
          name: 'secrets',
          status: 'ok',
          detail: '1 from the Secrets Store, 1 from Worker secrets, 0 not set',
        },
      ],
    });
  });

  it('turns health red and logs the name when a declared binding cannot be read', async () => {
    const written: string[] = [];
    const env = { STORE_GITHUB_WEBHOOK_SECRET: unreadableSecret() };
    await withSecrets(env, (line) => written.push(line));
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({
      level: 'error',
      outcome: 'secret_store_unreadable',
      secrets: 'GITHUB_WEBHOOK_SECRET',
    });
    expect((await health(env)).status).toBe('red');
  });
});

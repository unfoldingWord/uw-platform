import { describe, expect, it, vi } from 'vitest';
import { healthReportSchema } from '@uw/contracts';
import { storedSecret, unreadableSecret } from '@uw/core/platform-secrets-testing';
import { engineConfigOf } from './engines/config.ts';
import worker from './index.ts';
import { kmsConfigOf } from './credentials/kms/config.ts';
import { fakeKmsAccess } from './credentials/testing/fake-kms.ts';
import { platformSecretNames, withSecrets } from './secrets.ts';
import { indicatorText } from './views/parts/health-words.ts';

const commit = '0123456789abcdef0123456789abcdef01234567';

async function probe(env: Parameters<typeof worker.fetch>[1]) {
  const context = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
  };
  const request = new Request('https://uw-platform.test/health/probe');
  const response = await worker.fetch(request, env, context);
  return healthReportSchema.parse(await response.json());
}

function lines() {
  const written: Record<string, unknown>[] = [];
  return { written, sink: (line: string) => written.push(JSON.parse(line)) };
}

describe('#160 uw-platform reads its platform secrets through one seam', () => {
  it('lists every secret once', () => {
    expect(new Set(platformSecretNames).size).toBe(platformSecretNames.length);
    expect(platformSecretNames).toContain('CREDENTIALS_KMS_SECRET_ACCESS_KEY');
  });

  it('hands the code a plain string for a secret bound from the Secrets Store', async () => {
    const env = await withSecrets({
      AI_GATEWAY_ACCOUNT_ID: 'account',
      STORE_ANTHROPIC_API_KEY: storedSecret('anthropic-from-the-store'),
    });
    const config = engineConfigOf(env, fetch);
    expect(config.ANTHROPIC_API_KEY).toBe('anthropic-from-the-store');
    expect(env.AI_GATEWAY_ACCOUNT_ID).toBe('account');
  });

  it('configures KMS from the two store-bound credentials and the two plain settings', async () => {
    const env = await withSecrets({
      CREDENTIALS_KMS_REGION: 'us-west-2',
      CREDENTIALS_KMS_KEY_ID: 'alias/uw-credentials-staging',
      STORE_CREDENTIALS_KMS_ACCESS_KEY_ID: storedSecret(fakeKmsAccess.accessKeyId),
      STORE_CREDENTIALS_KMS_SECRET_ACCESS_KEY: storedSecret(fakeKmsAccess.secretAccessKey),
    });
    expect(kmsConfigOf(env)?.accessKeyId).toBe(fakeKmsAccess.accessKeyId);
    expect(env.SECRET_SOURCES?.['CREDENTIALS_KMS_SECRET_ACCESS_KEY']).toBe('secrets_store');
  });

  it('keeps reading a Worker secret that has no binding yet', async () => {
    const env = await withSecrets({ OPENAI_API_KEY: 'legacy-openai' });
    expect(env.OPENAI_API_KEY).toBe('legacy-openai');
    expect(env.SECRET_SOURCES?.['OPENAI_API_KEY']).toBe('worker_secret');
  });

  it('logs the name, never a value, when a binding cannot be read', async () => {
    const { written, sink } = lines();
    const env = { OPENAI_API_KEY: 'legacy-openai', STORE_OPENAI_API_KEY: unreadableSecret() };
    const resolved = await withSecrets(env, sink);
    expect(resolved.OPENAI_API_KEY).toBe('legacy-openai');
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      level: 'error',
      outcome: 'secret_store_unreadable',
      secrets: 'OPENAI_API_KEY',
    });
    expect(JSON.stringify(written)).not.toContain('legacy-openai');
  });
});

describe('#160 the uw-platform worker entry resolves secrets before any handler runs', () => {
  it('reports on the probe how many secrets came from each source, without a name or a value', async () => {
    const report = await probe({
      COMMIT_SHA: commit,
      ZULIP_BOT_API_KEY: 'legacy-zulip-key',
      STORE_ANTHROPIC_API_KEY: storedSecret('anthropic-from-the-store'),
    });
    const secrets = report.indicators.find((indicator) => indicator.name === 'secrets');
    expect(secrets).toEqual({
      name: 'secrets',
      status: 'ok',
      detail: `1 from the Secrets Store, 1 from Worker secrets, ${platformSecretNames.length - 2} not set`,
    });
    const told = JSON.stringify(report);
    expect(told).not.toContain('legacy-zulip-key');
    expect(told).not.toContain('anthropic-from-the-store');
    expect(told).not.toContain('ANTHROPIC');
  });

  it('turns the probe red when a declared binding cannot be read', async () => {
    const report = await probe({
      COMMIT_SHA: commit,
      OPENAI_API_KEY: 'legacy-openai',
      STORE_OPENAI_API_KEY: unreadableSecret(),
    });
    expect(report.status).toBe('red');
    expect(report.indicators.find((indicator) => indicator.name === 'secrets')?.detail).toContain(
      '1 unreadable in the Secrets Store',
    );
  });

  it('names the indicator on the Health screen', () => {
    expect(indicatorText('secrets')).toBe('Platform secrets');
  });
});

describe('#160 the queue consumer and the crons resolve secrets themselves', () => {
  it('reads a store-bound secret once when a queue batch and a cron share the env', async () => {
    const zulip = storedSecret('zulip-from-the-store');
    const env = { STORE_ZULIP_BOT_API_KEY: zulip };
    const batch = {
      queue: 'ingest',
      messages: [],
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      retryAll: () => undefined,
      ackAll: () => undefined,
    };
    const controller = { cron: 'never', scheduledTime: 0, noRetry: () => undefined };
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await worker.queue(batch, env);
    await worker.scheduled(controller, env);
    spy.mockRestore();
    expect(zulip.reads()).toBe(1);
  });
});

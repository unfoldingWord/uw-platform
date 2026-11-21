import { describe, expect, it } from 'vitest';
import {
  readPlatformSecrets,
  secretReader,
  secretsHealth,
  storeBindingOf,
  unreadSecretNames,
  workerSecrets,
} from './platform-secrets.ts';
import { storedSecret, unreadableSecret } from './platform-secrets-testing.ts';

const names = ['MODEL_KEY', 'BOT_KEY', 'WEBHOOK_SECRET'] as const;

describe('#160 a platform secret is read from the Secrets Store first, then from the Worker secret', () => {
  it('names the Secrets Store binding after the secret', () => {
    expect(storeBindingOf('MODEL_KEY')).toBe('STORE_MODEL_KEY');
  });

  it('reads a bound secret through get() and says it came from the Secrets Store', async () => {
    const env = { STORE_MODEL_KEY: storedSecret('from-the-store') };
    const read = await readPlatformSecrets(env, names);
    expect(read.values.MODEL_KEY).toBe('from-the-store');
    expect(read.sources.MODEL_KEY).toBe('secrets_store');
  });

  it('prefers the Secrets Store over a Worker secret of the same name', async () => {
    const env = { MODEL_KEY: 'legacy', STORE_MODEL_KEY: storedSecret('from-the-store') };
    const read = await readPlatformSecrets(env, names);
    expect(read.values.MODEL_KEY).toBe('from-the-store');
    expect(read.sources.MODEL_KEY).toBe('secrets_store');
  });

  it('falls back to the Worker secret while no binding is declared, and says so', async () => {
    const read = await readPlatformSecrets({ BOT_KEY: 'legacy' }, names);
    expect(read.values.BOT_KEY).toBe('legacy');
    expect(read.sources.BOT_KEY).toBe('worker_secret');
  });

  it('reports a secret with neither a binding nor a Worker secret as not set', async () => {
    const read = await readPlatformSecrets({ WEBHOOK_SECRET: '' }, names);
    expect(read.values).toEqual({});
    expect(read.sources).toEqual({
      MODEL_KEY: 'not_set',
      BOT_KEY: 'not_set',
      WEBHOOK_SECRET: 'not_set',
    });
  });
});

describe('#160 a binding that cannot be read is never hidden by the fallback', () => {
  it('does not hide a binding that cannot be read: it uses the Worker secret and names the failure', async () => {
    const env = { MODEL_KEY: 'legacy', STORE_MODEL_KEY: unreadableSecret() };
    const read = await readPlatformSecrets(env, names);
    expect(read.values.MODEL_KEY).toBe('legacy');
    expect(read.sources.MODEL_KEY).toBe('worker_secret_after_store_failure');
    expect(unreadSecretNames(read.sources)).toEqual(['MODEL_KEY']);
  });

  it('gives no value when the binding cannot be read and no Worker secret is left', async () => {
    const read = await readPlatformSecrets({ STORE_BOT_KEY: unreadableSecret() }, names);
    expect(read.values.BOT_KEY).toBeUndefined();
    expect(read.sources.BOT_KEY).toBe('store_unreadable');
    expect(unreadSecretNames(read.sources)).toEqual(['BOT_KEY']);
  });

  it('ignores a binding that is not a Secrets Store secret', async () => {
    const read = await readPlatformSecrets({ STORE_BOT_KEY: 'a string', BOT_KEY: 'legacy' }, names);
    expect(read.sources.BOT_KEY).toBe('worker_secret');
  });

  it('never carries a value in its sources', async () => {
    const env = { MODEL_KEY: 'legacy-value', STORE_BOT_KEY: storedSecret('store-value') };
    const read = await readPlatformSecrets(env, names);
    const told = JSON.stringify([read.sources, secretsHealth(read.sources)]);
    expect(told).not.toContain('legacy-value');
    expect(told).not.toContain('store-value');
  });
});

describe('#160 health says which source each platform secret came from, by count', () => {
  it('is healthy when every secret that is set came from the Secrets Store', () => {
    const health = secretsHealth({ A: 'secrets_store', B: 'secrets_store', C: 'not_set' });
    expect(health).toEqual({
      status: 'ok',
      detail: '2 from the Secrets Store, 0 from Worker secrets, 1 not set',
    });
  });

  it('stays healthy and counts the Worker secrets while the move is under way', () => {
    const health = secretsHealth({ A: 'secrets_store', B: 'worker_secret', C: 'worker_secret' });
    expect(health).toEqual({
      status: 'ok',
      detail: '1 from the Secrets Store, 2 from Worker secrets, 0 not set',
    });
  });

  it('is red when a declared binding could not be read, even though a Worker secret covered it', () => {
    const health = secretsHealth({
      A: 'secrets_store',
      B: 'worker_secret_after_store_failure',
      C: 'store_unreadable',
    });
    expect(health).toEqual({
      status: 'red',
      detail:
        '1 from the Secrets Store, 1 from Worker secrets, 0 not set, 2 unreadable in the Secrets Store',
    });
  });

  it('is not configured when no secret is set anywhere', () => {
    expect(secretsHealth({ A: 'not_set', B: 'not_set' })).toEqual({
      status: 'not_configured',
      detail: '0 from the Secrets Store, 0 from Worker secrets, 2 not set',
    });
  });
});

describe('#160 secrets are read once per Worker instance and re-read on a timer', () => {
  function clockAt(start: number) {
    const clock = { ms: start };
    return { clock, now: () => clock.ms };
  }

  it('reads each binding once for many requests on the same env', async () => {
    const secret = storedSecret('value');
    const env = { STORE_MODEL_KEY: secret };
    const { now } = clockAt(0);
    const read = secretReader(names, { freshMs: 1000, retryMs: 100, now });
    const [first, second] = await Promise.all([read(env), read(env)]);
    await read(env);
    expect(first).toBe(second);
    expect(secret.reads()).toBe(1);
  });

  it('reads again once the reading is older than its freshness, so a rotated value arrives', async () => {
    const secret = storedSecret('before');
    const env = { STORE_MODEL_KEY: secret };
    const { clock, now } = clockAt(0);
    const read = secretReader(names, { freshMs: 1000, retryMs: 100, now });
    await read(env);
    secret.rotate('after');
    clock.ms = 999;
    expect((await read(env)).values.MODEL_KEY).toBe('before');
    clock.ms = 1000;
    expect((await read(env)).values.MODEL_KEY).toBe('after');
  });

  it('retries sooner after a binding could not be read', async () => {
    const secret = unreadableSecret();
    const env = { STORE_MODEL_KEY: secret };
    const { clock, now } = clockAt(0);
    const read = secretReader(names, { freshMs: 1000, retryMs: 100, now });
    await read(env);
    clock.ms = 99;
    await read(env);
    expect(secret.reads()).toBe(1);
    clock.ms = 100;
    await read(env);
    expect(secret.reads()).toBe(2);
  });

  it('keeps one env apart from another', async () => {
    const { now } = clockAt(0);
    const read = secretReader(names, { freshMs: 1000, retryMs: 100, now });
    const one = await read({ STORE_MODEL_KEY: storedSecret('one') });
    const two = await read({ STORE_MODEL_KEY: storedSecret('two') });
    expect([one.values.MODEL_KEY, two.values.MODEL_KEY]).toEqual(['one', 'two']);
  });
});

describe('#160 a Worker entry gets its env back with every secret as a plain string', () => {
  const options = { freshMs: 1000, retryMs: 100, now: () => 0 };

  it('keeps the other bindings, fills in the secrets and carries the sources', async () => {
    const resolve = workerSecrets(names, options);
    const env = { COMMIT_SHA: 'abc', BOT_KEY: 'legacy', STORE_MODEL_KEY: storedSecret('stored') };
    const resolved = await resolve(env, () => undefined);
    expect(resolved).toMatchObject({ COMMIT_SHA: 'abc', BOT_KEY: 'legacy', MODEL_KEY: 'stored' });
    expect(resolved.SECRET_SOURCES).toEqual({
      MODEL_KEY: 'secrets_store',
      BOT_KEY: 'worker_secret',
      WEBHOOK_SECRET: 'not_set',
    });
  });

  it('reports an unreadable binding once per reading, by name', async () => {
    const resolve = workerSecrets(names, options);
    const env = { STORE_MODEL_KEY: unreadableSecret() };
    const reports: (readonly string[])[] = [];
    await resolve(env, (unread) => reports.push(unread));
    await resolve(env, (unread) => reports.push(unread));
    expect(reports).toEqual([['MODEL_KEY']]);
  });
});

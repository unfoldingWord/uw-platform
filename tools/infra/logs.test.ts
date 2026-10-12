import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

const THIRTY_DAYS_SECONDS = 2592000;

function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined,
    value,
  );
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function destination(): URL {
  return new URL(String(at(readJson('infra/logs/logpush-workers.json'), 'destination_conf')));
}

function observabilityEnabled(path: string): unknown[] {
  const config = parse(readFileSync(path, 'utf8'));
  return [
    at(config, 'observability', 'enabled'),
    at(config, 'env', 'staging', 'observability', 'enabled'),
    at(config, 'env', 'production', 'observability', 'enabled'),
  ];
}

describe('FD-11 log retention and shipping are declared', () => {
  it('expires every log object after 30 days', () => {
    const rule = at(readJson('infra/logs/r2-lifecycle.json'), 'rules', 0);
    expect(at(rule, 'enabled')).toBe(true);
    expect(at(rule, 'conditions', 'prefix')).toBe('');
    expect(at(rule, 'deleteObjectsTransition', 'condition')).toEqual({
      type: 'Age',
      maxAge: THIRTY_DAYS_SECONDS,
    });
  });

  it('ships Workers trace events into the uw-logs bucket', () => {
    const job = readJson('infra/logs/logpush-workers.json');
    expect(at(job, 'dataset')).toBe('workers_trace_events');
    expect(at(job, 'enabled')).toBe(true);
    expect(destination().protocol).toBe('r2:');
    expect(destination().hostname).toBe('uw-logs');
  });

  it('holds no credential in the destination, only placeholders', () => {
    const keys = ['account-id', 'access-key-id', 'secret-access-key'];
    expect(keys.map((key) => destination().searchParams.get(key))).toEqual([
      '${CLOUDFLARE_ACCOUNT_ID}',
      '${R2_ACCESS_KEY_ID}',
      '${R2_SECRET_ACCESS_KEY}',
    ]);
  });

  it.each(['infra/uw-app/wrangler.toml', 'infra/uw-ingest/wrangler.toml'])(
    '%s enables observability at the top level, in staging and in production',
    (file) => {
      expect(observabilityEnabled(file)).toEqual([true, true, true]);
    },
  );
});

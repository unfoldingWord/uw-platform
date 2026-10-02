import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

type Block = Record<string, unknown>;

const registered = /export const GITHUB_SWEEP_CRON = '([^']+)';/;
const deployed = ['staging', 'production'] as const;

function sweepCron(): string {
  const source = readFileSync('apps/uw-app/cron/registry.ts', 'utf8');
  return registered.exec(source)?.[1] ?? '';
}

function environment(file: string, name: string): Block {
  const config = parse(readFileSync(`infra/uw-app/${file}`, 'utf8')) as Block;
  const environments = (config['env'] ?? {}) as Record<string, Block>;
  return environments[name] ?? {};
}

function cronsOf(block: Block): unknown {
  const triggers = (block['triggers'] ?? {}) as Block;
  return triggers['crons'];
}

describe('GH-2 the deployed crons are the registered ones', () => {
  it('registers the nightly sweep at 03:17 UTC', () => {
    expect(sweepCron()).toBe('17 3 * * *');
  });

  it.each(deployed)('the go-live %s environment triggers exactly the registered crons', (name) => {
    expect(cronsOf(environment('wrangler.go-live.toml', name))).toEqual([sweepCron()]);
  });

  it.each(deployed)('the live %s environment triggers no cron until go-live', (name) => {
    expect(environment('wrangler.toml', name)['triggers']).toBeUndefined();
  });

  it.each(['wrangler.toml', 'wrangler.go-live.toml'])('%s preview triggers no cron', (file) => {
    expect(environment(file, 'preview')['triggers']).toBeUndefined();
  });
});

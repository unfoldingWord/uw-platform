import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { goLiveSwitchedOn } from './switch.ts';

type Block = Record<string, unknown>;

const registered = /export const GITHUB_SWEEP_CRON = '([^']+)';/;
const minute = /export const MINUTE_CRON = '([^']+)';/;
const deployed = ['staging', 'production'] as const;

function registeredCron(pattern: RegExp): string {
  const source = readFileSync('apps/uw-app/cron/registry.ts', 'utf8');
  return pattern.exec(source)?.[1] ?? '';
}

function sweepCron(): string {
  return registeredCron(registered);
}

function environmentIn(text: string, name: string): Block {
  const config = parse(text) as Block;
  const environments = (config['env'] ?? {}) as Record<string, Block>;
  return environments[name] ?? {};
}

function environment(file: string, name: string): Block {
  return environmentIn(readFileSync(`infra/uw-app/${file}`, 'utf8'), name);
}

function everyCron(text: string): unknown[] {
  const config = parse(text) as Block;
  const environments = Object.values((config['env'] ?? {}) as Record<string, Block>);
  return [config, ...environments].flatMap((block) => {
    const crons = cronsOf(block);
    return Array.isArray(crons) ? crons : [];
  });
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
    expect(cronsOf(environment('wrangler.go-live.toml', name))).toEqual([
      sweepCron(),
      registeredCron(minute),
    ]);
  });

  it('registers the minute cron every minute', () => {
    expect(registeredCron(minute)).toBe('* * * * *');
  });

  it('finds a cron in the live file only once the switch is on', () => {
    const twin = goLiveSwitchedOn()
      ? readFileSync('infra/uw-app/wrangler.go-live.toml', 'utf8')
      : '';
    expect(everyCron(readFileSync('infra/uw-app/wrangler.toml', 'utf8'))).toEqual(everyCron(twin));
  });

  it('flags a planted minute cron in the live file, at the top or under an environment', () => {
    const top = '[triggers]\ncrons = ["* * * * *"]\n';
    const staged = '[env.staging.triggers]\ncrons = ["* * * * *"]\n';
    expect(everyCron(top)).toEqual(['* * * * *']);
    expect(everyCron(staged)).toEqual(['* * * * *']);
    expect(cronsOf(environmentIn(staged, 'staging'))).toEqual(['* * * * *']);
  });

  it.each(deployed)(
    'the live %s environment triggers its crons only once the switch is on',
    (name) => {
      const twin = goLiveSwitchedOn() ? environment('wrangler.go-live.toml', name) : {};
      expect(environment('wrangler.toml', name)['triggers']).toEqual(twin['triggers']);
    },
  );

  it.each(['wrangler.toml', 'wrangler.go-live.toml'])('%s preview triggers no cron', (file) => {
    expect(environment(file, 'preview')['triggers']).toBeUndefined();
  });
});

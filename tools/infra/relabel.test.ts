import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { orphanedApps, phaseOne, workerName } from './relabel.ts';

const live = readFileSync('infra/uw-platform/wrangler.toml', 'utf8');

type Env = {
  readonly name: string;
  readonly migrations?: readonly { readonly tag: string }[];
  readonly durable_objects?: unknown;
  readonly containers?: unknown;
  readonly hyperdrive?: unknown;
  readonly queues?: unknown;
  readonly workflows?: unknown;
  readonly vars?: unknown;
};

function envOf(text: string, name: string): Env {
  return (parse(text) as unknown as { env: Record<string, Env> }).env[name] as Env;
}

describe('the phase-one config that deletes the Durable Object classes', () => {
  it.each(['staging', 'production'])(
    'for %s stops at the delete step and drops the class bindings and containers',
    (name) => {
      const before = envOf(live, name);
      const after = envOf(phaseOne(live, name), name);
      expect(after.migrations?.map((step) => step.tag)).toEqual(['v1', 'v2', 'v3', 'v4']);
      expect(after.durable_objects).toBeUndefined();
      expect(after.containers).toBeUndefined();
      expect(after.name).toBe(before.name);
      expect(after.hyperdrive).toEqual(before.hyperdrive);
      expect(after.queues).toEqual(before.queues);
      expect(after.workflows).toEqual(before.workflows);
      expect(after.vars).toEqual(before.vars);
    },
  );

  it('leaves every other environment as it was', () => {
    const after = phaseOne(live, 'production');
    for (const name of ['staging', 'preview'])
      expect(envOf(after, name)).toEqual(envOf(live, name));
  });

  it('the release config then applies the recreate step after the delete, then the measure sandbox', () => {
    const steps = envOf(live, 'production').migrations?.map((step) => step.tag);
    expect(steps).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
  });

  it('rewrites the file it is given in place, as CI does on its own checkout', () => {
    expect(phaseOne(phaseOne(live, 'production'), 'production')).toBe(phaseOne(live, 'production'));
  });

  it('refuses an environment it does not know', () => {
    expect(() => phaseOne(live, 'preview')).toThrow('unknown environment preview');
  });

  it('names the Worker each environment deploys', () => {
    expect(workerName(live, 'production')).toBe('uw-platform');
    expect(workerName(live, 'staging')).toBe('uw-platform-staging');
  });
});

describe('the container applications left without their Durable Object', () => {
  const apps = [
    { id: 'a', name: 'uw-platform-claudecodesandbox-production', namespaceId: 'gone' },
    { id: 'b', name: 'uw-platform-codexsandbox-production', namespaceId: 'live' },
    { id: 'c', name: 'uw-platform-staging-codexsandbox-staging', namespaceId: 'gone' },
    { id: 'd', name: 'another-worker-box', namespaceId: 'gone' },
  ];

  it('are only that Worker’s applications whose namespace no longer exists', () => {
    const owner = { worker: 'uw-platform', environment: 'production' };
    const orphans = orphanedApps(apps, new Set(['live']), owner);
    expect(orphans.map((app) => app.id)).toEqual(['a']);
    const staging = { worker: 'uw-platform-staging', environment: 'staging' };
    expect(orphanedApps(apps, new Set(['live']), staging).map((app) => app.id)).toEqual(['c']);
  });
});

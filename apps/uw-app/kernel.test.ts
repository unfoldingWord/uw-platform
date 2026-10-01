import { describe, expect, it } from 'vitest';
import { platformKernel, platformPorts } from './kernel.ts';
import { systemClock } from './ports/clock.ts';
import { connectorsNotWired } from './ports/connectors.not-wired.ts';
import { githubFactsNotWired } from './ports/github-facts.not-wired.ts';
import { grantsNotWired } from './ports/grants.not-wired.ts';
import { hubNotWired } from './ports/hub.not-wired.ts';
import { randomIds } from './ports/ids.ts';
import { modelEngineNotWired } from './ports/model-engine.not-wired.ts';
import { notifierNotWired } from './ports/notifier.not-wired.ts';
import { runsNotWired } from './ports/runs.not-wired.ts';
import { storeNotWired } from './ports/store.not-wired.ts';

const expected = {
  clock: systemClock,
  ids: randomIds,
  store: storeNotWired,
  grants: grantsNotWired,
  githubFacts: githubFactsNotWired,
  connectors: connectorsNotWired,
  modelEngine: modelEngineNotWired,
  hub: hubNotWired,
  notifier: notifierNotWired,
  runs: runsNotWired,
};

function mismatched(): Record<string, unknown> {
  const ports = platformPorts(null);
  return Object.fromEntries(
    Object.entries(expected).filter(([name, adapter]) => Reflect.get(ports, name) !== adapter),
  );
}

describe('DX-1 the Worker builds the kernel over platform adapters', () => {
  it('uses the platform clock and ids, and not-wired adapters for the services later steps build', () => {
    expect(Object.keys(platformPorts(null))).toEqual(Object.keys(expected));
    expect(mismatched()).toEqual({});
  });

  it('reports a Worker with no database as a store that is not wired', async () => {
    await expect(platformKernel(null).health()).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'store',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { contractRequest } from '@uw/harness/port-contracts/connectors';
import { platformKernel, platformPorts } from './kernel.ts';
import { systemClock } from './ports/clock.ts';
import { githubFactsNotWired } from './ports/github-facts.not-wired.ts';
import { grantsNotWired } from './ports/grants.not-wired.ts';
import { hubNotWired } from './ports/hub.not-wired.ts';
import { randomIds } from './ports/ids.ts';
import { modelEngineNotWired } from './ports/model-engine.not-wired.ts';
import { notifierNotWired } from './ports/notifier.not-wired.ts';
import { runsNotWired } from './ports/runs.not-wired.ts';
import { storeNotWired } from './ports/store.not-wired.ts';

const portNames = [
  'clock',
  'ids',
  'store',
  'grants',
  'githubFacts',
  'connectors',
  'modelEngine',
  'hub',
  'notifier',
  'runs',
];

const expected = {
  clock: systemClock,
  ids: randomIds,
  store: storeNotWired,
  grants: grantsNotWired,
  githubFacts: githubFactsNotWired,
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
    expect(Object.keys(platformPorts(null))).toEqual(portNames);
    expect(mismatched()).toEqual({});
  });

  it('answers the merge as not wired when the kernel is given no ship GitHub', async () => {
    const { connectors } = platformPorts(null);
    expect(await connectors.run({ ...contractRequest, connector: 'merge' })).toEqual({
      outcome: 'refused',
      reason: 'not_wired',
    });
  });

  it('reports a Worker with no database as a store that is not wired', async () => {
    await expect(platformKernel(null).health()).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'store',
    });
  });
});

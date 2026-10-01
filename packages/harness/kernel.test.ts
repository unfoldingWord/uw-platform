import { describe, expect, it } from 'vitest';
import { createKernel, notWiredCall, type Ports } from './index.ts';

const now = new Date('2026-10-01T09:00:00.000Z');

function notWiredPorts(): Ports {
  return {
    clock: { now: () => new Date(now) },
    ids: { next: () => 'c1000000-0000-4000-8000-000000000001' },
    store: {
      transaction: () => notWiredCall('store', 'transaction'),
      appliedMigrations: () => notWiredCall('store', 'appliedMigrations'),
    },
    grants: {
      resolve: () => notWiredCall('grants', 'resolve'),
      lockAndReread: () => notWiredCall('grants', 'lockAndReread'),
    },
    githubFacts: { pullRequest: () => notWiredCall('githubFacts', 'pullRequest') },
    connectors: { run: () => notWiredCall('connectors', 'run') },
    modelEngine: { turn: () => notWiredCall('modelEngine', 'turn') },
    hub: { wake: () => notWiredCall('hub', 'wake') },
    notifier: { notify: () => notWiredCall('notifier', 'notify') },
    runs: {
      start: () => notWiredCall('runs', 'start'),
      hibernate: () => notWiredCall('runs', 'hibernate'),
      resume: () => notWiredCall('runs', 'resume'),
      stop: () => notWiredCall('runs', 'stop'),
      status: () => notWiredCall('runs', 'status'),
    },
  };
}

describe('DX-1 createKernel(ports)', () => {
  it('builds over ten ports without calling one, and walks as the pure walker does', () => {
    expect(createKernel(notWiredPorts()).walk([])).toEqual([]);
  });

  it('reads health from the clock and the store', async () => {
    const base = notWiredPorts();
    const ports = { ...base, store: { ...base.store, appliedMigrations: async () => [1, 2] } };
    expect(await createKernel(ports).health()).toEqual({ now, appliedMigrations: [1, 2] });
  });

  it('reports a store that is not wired as PortNotWiredError', async () => {
    await expect(createKernel(notWiredPorts()).health()).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'store',
      method: 'appliedMigrations',
    });
  });
});

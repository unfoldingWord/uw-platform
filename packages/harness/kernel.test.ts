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
      resolveIn: () => notWiredCall('grants', 'resolveIn'),
      lockAndReread: () => notWiredCall('grants', 'lockAndReread'),
      holders: () => notWiredCall('grants', 'holders'),
    },
    githubFacts: {
      pullRequest: () => notWiredCall('githubFacts', 'pullRequest'),
      refresh: () => notWiredCall('githubFacts', 'refresh'),
      diff: () => notWiredCall('githubFacts', 'diff'),
      epic: () => notWiredCall('githubFacts', 'epic'),
      authors: () => notWiredCall('githubFacts', 'authors'),
    },
    connectors: {
      run: () => notWiredCall('connectors', 'run'),
      outcomeOf: () => notWiredCall('connectors', 'outcomeOf'),
      review: () => notWiredCall('connectors', 'review'),
    },
    modelEngine: {
      turn: () => notWiredCall('modelEngine', 'turn'),
      spend: () => notWiredCall('modelEngine', 'spend'),
    },
    hub: { wake: () => notWiredCall('hub', 'wake'), present: () => notWiredCall('hub', 'present') },
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

function throwingPorts(): Ports {
  const refuse = (): never => {
    throw new Error('a port was called');
  };
  return {
    clock: { now: refuse },
    ids: { next: refuse },
    store: { transaction: refuse, appliedMigrations: refuse },
    grants: { resolve: refuse, resolveIn: refuse, lockAndReread: refuse, holders: refuse },
    githubFacts: {
      pullRequest: refuse,
      refresh: refuse,
      diff: refuse,
      epic: refuse,
      authors: refuse,
    },
    connectors: { run: refuse, outcomeOf: refuse, review: refuse },
    modelEngine: { turn: refuse, spend: refuse },
    hub: { wake: refuse, present: refuse },
    notifier: { notify: refuse },
    runs: { start: refuse, hibernate: refuse, resume: refuse, stop: refuse, status: refuse },
  };
}

describe('DX-1 createKernel(ports)', () => {
  it('builds over ten ports without calling one', () => {
    expect(() => createKernel(throwingPorts())).not.toThrow();
  });

  it('walks as the pure walker does, without calling a port', () => {
    expect(createKernel(throwingPorts()).walk([])).toEqual([]);
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

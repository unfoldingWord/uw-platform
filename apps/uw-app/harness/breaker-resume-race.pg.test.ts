import { randomUUID } from 'node:crypto';
import { systemPrincipal } from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import type { Caller, ModelEngine, Store } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { platformRuns } from '../ports/runs.ts';
import { platformStore } from '../ports/store.ts';
import { accepted, callerOf, eventsNamed } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { hostRig, startedRun, type HostRig } from '../testing/run-host.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const breakerKey = 'harness-breaker';

type Connections = {
  readonly actor: Database;
  readonly holder: Database;
  readonly observer: Database;
};

type Hold = { readonly locked: Promise<void>; release(): void };

const pausingSpend: ModelEngine = {
  turn: () => Promise.reject(new Error('the race serves no model turn')),
  spend: async (since) => ({ spentMinor: 120_000, currency: 'USD', since, asOf: new Date() }),
};

function holdingStore(store: Store): Store & Hold {
  let locked = (): void => undefined;
  const lockedOnce = new Promise<void>((resolve) => void (locked = resolve));
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  let held = false;
  return {
    locked: lockedOnce,
    release: () => release(),
    appliedMigrations: () => store.appliedMigrations(),
    transaction: (work) =>
      store.transaction(async (tx) => {
        const lock = tx.lock;
        Object.assign(tx, {
          lock: async (key: string) => {
            await lock(key);
            if (key !== breakerKey || held) return;
            held = true;
            locked();
            await released;
          },
        });
        return work(tx);
      }),
  };
}

async function inConnections(work: (connections: Connections) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    actor: createClient(database.connectionString),
    holder: createClient(database.connectionString),
    observer: createClient(database.connectionString),
  };
  try {
    await work(connections);
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

async function pausedRun(rig: HostRig): Promise<string> {
  const runId = await startedRun(rig);
  const lane = { harnessId: rig.harnessId, stageKey: null };
  accepted(await rig.kernel.stages.pause(callerOf(rig.admin), lane));
  return runId;
}

async function resumeBehindTheBreaker(connections: Connections) {
  const rig = await hostRig(connections.actor, host);
  const runId = await pausedRun(rig);
  const store = holdingStore(platformStore(connections.holder));
  const breaker = kernelOn(connections.holder, rig.clock, {
    store,
    modelEngine: pausingSpend,
    runs: platformRuns(rig.binding),
  });
  rig.clock.advance(60_000);
  const since = rig.clock.now();
  const checking = breaker.breaker.check(host, { capMinor: 125_000, currency: 'USD', since });
  await store.locked;
  const lane = { harnessId: rig.harnessId, stageKey: null };
  const resuming = rig.kernel.stages.resume(callerOf(rig.admin), lane);
  await awaitBlocked(() => lockWaiters(connections.observer));
  store.release();
  accepted(await checking);
  accepted(await resuming);
  const run = await platformStore(connections.actor).transaction((tx) =>
    tx.harnessRuns.read.byId(runId),
  );
  return { rig, run };
}

function isResume(call: string): boolean {
  return call.startsWith('resume');
}

describe.skipIf(!testServer)('HE-5 a resume racing the spend breaker, on real connections', () => {
  it("HE-5 a resume waiting on the breaker's exclusive hold sees pausing and leaves the run hibernated", () =>
    inConnections(async (connections) => {
      const { rig, run } = await resumeBehindTheBreaker(connections);
      expect(run).toMatchObject({ outcome: 'hibernated', hibernatedFor: 'breaker' });
      expect(await eventsNamed(connections.actor, rig.harnessId, 'run_resumed')).toEqual([]);
      expect(rig.binding.calls.filter(isResume)).toEqual([]);
    }));
});

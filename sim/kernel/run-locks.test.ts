import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { createKernel, type Grants, type Store, type StoreTransaction } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simSeenHead } from '../fixtures.ts';
import {
  beatOf,
  gateWorld,
  parkedRun,
  runWorld,
  startOn,
  stepOn,
  systemCaller,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Logs = string[][];

type Make = (world: World) => Promise<RunWorld>;

const ranks: ReadonlyMap<string, number> = new Map([
  ['stage', 0],
  ['item', 1],
  ['grants', 2],
  ['delegation', 3],
  ['run', 4],
  ['append', 5],
]);

function logged<A extends unknown[], R>(log: string[], name: string, call: (...args: A) => R) {
  return (...args: A): R => {
    log.push(name);
    return call(...args);
  };
}

const breakerKey = 'harness-breaker';

function instrument(tx: StoreTransaction, log: string[]): void {
  const { lock, lockShared } = tx;
  Object.assign(tx, {
    lock: (key: string) => {
      if (key.startsWith('harness-stage')) log.push('stage');
      if (key === breakerKey) log.push('breaker exclusive');
      return lock(key);
    },
    lockShared: (key: string) => {
      log.push(key === breakerKey ? 'breaker shared' : 'shared');
      return lockShared(key);
    },
  });
  const { harnessItems, harnessRuns, delegations, harnessEvents } = tx;
  Object.assign(harnessItems.read, { lock: logged(log, 'item', harnessItems.read.lock) });
  Object.assign(harnessRuns.read, { lock: logged(log, 'run', harnessRuns.read.lock) });
  Object.assign(harnessRuns.write, {
    insert: logged(log, 'run', harnessRuns.write.insert),
    update: logged(log, 'run', harnessRuns.write.update),
  });
  Object.assign(delegations.write, {
    markLapsed: logged(log, 'delegation', delegations.write.markLapsed),
  });
  Object.assign(harnessEvents.write, { append: logged(log, 'append', harnessEvents.write.append) });
}

function spied(world: World): { readonly world: World; readonly logs: Logs } {
  const logs: Logs = [];
  const byTx = new WeakMap<StoreTransaction, string[]>();
  const { store, grants } = world.adapters;
  const spyStore: Store = {
    ...store,
    transaction: (work) =>
      store.transaction((tx) => {
        const log: string[] = [];
        logs.push(log);
        byTx.set(tx, log);
        instrument(tx, log);
        return work(tx);
      }),
  };
  const spyGrants: Grants = {
    ...grants,
    lockAndReread: (tx, personId, at) => {
      byTx.get(tx)?.push('grants');
      return grants.lockAndReread(tx, personId, at);
    },
  };
  const ports = { ...world.adapters, store: spyStore, grants: spyGrants };
  return { world: { ...world, kernel: createKernel(ports) }, logs };
}

function firstSeen(log: readonly string[]): readonly string[] {
  return log.filter((name, index) => log.indexOf(name) === index);
}

function outOfOrder(logs: Logs): readonly (readonly string[])[] {
  return logs.map(firstSeen).filter((seen) => {
    const order = seen.map((name) => ranks.get(name) ?? -1);
    return order.some((rank, index) => index > 0 && rank <= (order[index - 1] ?? -1));
  });
}

async function inSpied(make: Make, work: (scene: RunWorld, logs: Logs) => Promise<void>) {
  const base = await createWorld();
  try {
    const { world, logs } = spied(base);
    await work(await make(world), logs);
    expect(outOfOrder(logs)).toEqual([]);
    expect(logs.some((log) => log.includes('run'))).toBe(true);
  } finally {
    await base.close();
  }
}

function revoke(scene: RunWorld) {
  return scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.owner), {
    delegationId: scene.delegationId,
  });
}

async function lastLog(logs: Logs, work: () => Promise<unknown>): Promise<readonly string[]> {
  const before = logs.length;
  await work();
  return firstSeen(logs.slice(before).flat());
}

async function hostedPaths(scene: RunWorld, logs: Logs): Promise<void> {
  const owner = simCaller(scene.world, scene.owner);
  const runs = scene.world.kernel.runs;
  const started = await lastLog(logs, async () => value(await startOn(scene)));
  expect(started.slice(-2)).toEqual(['run', 'append']);
  const [run] = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessRuns.read.live(scene.harnessId),
  );
  const runId = run?.id ?? '';
  await runs.scene(systemCaller(scene), runId);
  value(await stepOn(scene, await beatOf(scene), { runId, step: 'read' }));
  const prompted = await lastLog(logs, () =>
    runs.prompt(owner, { itemId: scene.itemId, message: 'Keep it small.' }),
  );
  expect(prompted).toEqual(['item', 'grants', 'run', 'append']);
  const stopped = await lastLog(logs, () => runs.stop(owner, { itemId: scene.itemId }));
  expect(stopped).toEqual(['item', 'grants', 'run', 'append']);
}

async function lapsedScene(scene: RunWorld, logs: Logs): Promise<void> {
  const { runId } = value(await startOn(scene));
  value(await revoke(scene));
  const seen = await lastLog(logs, () => scene.world.kernel.runs.scene(systemCaller(scene), runId));
  expect(seen).toEqual(['item', 'delegation', 'run', 'append']);
}

async function transactionsDuring(logs: Logs, work: () => Promise<unknown>) {
  const before = logs.length;
  await work();
  return logs.slice(before).map(firstSeen);
}

function decide(scene: RunWorld) {
  return async () =>
    scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
      itemId: scene.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: await simSeenHead(scene.world, scene.itemId),
    });
}

function checkAt(scene: RunWorld, percent: number) {
  return async () => {
    scene.world.adapters.modelEngine.setSpend({ spentMinor: 1250 * percent, currency: 'USD' });
    const since = scene.world.adapters.clock.now();
    return value(
      await scene.world.kernel.breaker.check(systemCaller(scene), {
        capMinor: 125_000,
        currency: 'USD',
        since,
      }),
    );
  };
}

async function breakerPaths(scene: RunWorld, logs: Logs): Promise<void> {
  const parked = await parkedRun(scene);
  value(await scene.world.kernel.runs.hibernateAtGate(systemCaller(scene), parked.runId));
  const resume = ['breaker shared', 'item', 'run', 'append'];
  const record = ['breaker exclusive', 'append'];
  expect(await transactionsDuring(logs, checkAt(scene, 95))).toContainEqual(record);
  expect(await transactionsDuring(logs, decide(scene))).toContainEqual(resume);
  const reopened = await transactionsDuring(logs, checkAt(scene, 0));
  expect(reopened).toContainEqual(record);
  expect(reopened).toContainEqual(resume);
}

async function gatePaths(scene: RunWorld): Promise<void> {
  const parked = await parkedRun(scene);
  const runs = scene.world.kernel.runs;
  value(await runs.hibernateAtGate(systemCaller(scene), parked.runId));
  const decided = await scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
  expect(decided.status).toBe('accepted');
  value(
    await runs.complete(systemCaller(scene), parked.runId, { result: 'decided', review: null }),
  );
}

async function lapsedHibernate(scene: RunWorld, logs: Logs): Promise<void> {
  const parked = await parkedRun(scene);
  value(await revoke(scene));
  const hibernate = await lastLog(logs, () =>
    scene.world.kernel.runs.hibernateAtGate(systemCaller(scene), parked.runId),
  );
  expect(hibernate).toEqual(['item', 'delegation', 'run', 'append']);
}

async function endingPaths(scene: RunWorld): Promise<void> {
  const runs = scene.world.kernel.runs;
  const host = systemCaller(scene);
  const first = value(await startOn(scene));
  value(await runs.holdPremise(host, first.runId, { reason: 'The plan is already done.' }));
  const second = value(await startOn(scene));
  value(await runs.halt(host, second.runId, 'lease_expired'));
  const third = value(await startOn(scene));
  value(
    await runs.fail(host, third.runId, { step: 'work', why: 'retries_exhausted', detail: null }),
  );
}

describe('run-host lock order', () => {
  it('start, scene, step, prompt and stop take the item, then grants, then the run row, then append', () =>
    inSpied(runWorld, hostedPaths));

  it('a scene that finds the delegation lapsed marks it before it locks the run row', () =>
    inSpied(runWorld, lapsedScene));

  it('submit, hibernate, the resume after a decision and complete keep the order', () =>
    inSpied(gateWorld, (scene) => gatePaths(scene)));

  it('a hibernation that finds the delegation lapsed marks it before it locks the run row', () =>
    inSpied(gateWorld, lapsedHibernate));

  it('the breaker takes its lock exclusive and every resume takes it shared, before any other lock', () =>
    inSpied(gateWorld, breakerPaths));

  it('held premise, halt and fail keep the order', () =>
    inSpied(runWorld, (scene) => endingPaths(scene)));
});

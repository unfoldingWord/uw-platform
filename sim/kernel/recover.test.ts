import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { createKernel, software, type Connectors, type Kernel } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson, simSystem } from '../fixtures.ts';
import { kernelThatLosesTheExit } from '../lost-exit.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  simParkedAtShip,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

const sixteenMinutes = 16 * 60_000;
const head = standardChange.head;
const movedHead = simSha('fff999');

function giveFacts(world: World, itemId: string, onHead: string, reviewId: number): void {
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', onHead, reviewId)];
  world.adapters.githubFacts.given(greenFacts(world, { itemId, head: onHead, reviews }));
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const parked = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: max,
      title: 'Show the board',
      change: standardChange,
    });
    giveFacts(world, parked.itemId, head, 9100000101);
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin, max });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function decide(scene: Scene, kernel: Kernel, decision: 'approve' | 'take_over') {
  return kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision,
    reason: null,
    findings: [],
  });
}

function recoverAs(scene: Scene, who: Principal, kernel: Kernel = scene.world.kernel) {
  return kernel.gates.recoverConnectors(simCaller(scene.world, who), {
    harnessId: scene.harnessId,
  });
}

async function lostApproval(scene: Scene, effectHappened: boolean): Promise<void> {
  const losing = kernelThatLosesTheExit(scene.world, { effectHappened });
  await expect(decide(scene, losing, 'approve')).rejects.toMatchObject({ name: 'ExitLost' });
}

function logOf(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.itemId);
}

function withConnectors(scene: Scene, connectors: Connectors): Kernel {
  return createKernel({ ...scene.world.adapters, connectors });
}

async function expectNothingRecorded(scene: Scene, who: Principal, reason: string) {
  const before = await logOf(scene);
  expect(await recoverAs(scene, who)).toMatchObject({ status: 'error', reason });
  expect(await logOf(scene)).toEqual(before);
}

describe('GH-6 only a person with admin on the area recovers a stuck parking', () => {
  sceneIt('refuses every agent form, even one carrying admin grants', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    const agent = simAgent(scene.ian, `${scene.ian.personId}/builder`, { interactive: true });
    const borrowed = { ...scene.ian, identity: scene.max.identity };
    const unnamed = { ...scene.ian, personId: null };
    for (const who of [agent, simSystem(), borrowed, unnamed]) {
      await expectNothingRecorded(scene, who, 'not_permitted');
    }
  });

  sceneIt('refuses an area editor', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    await expectNothingRecorded(scene, scene.max, 'not_permitted');
  });

  sceneIt('re-reads the grants and refuses an admin whose grant has lapsed', async (scene) => {
    const lapsing = await simPerson(scene.world, 3, [
      {
        role: 'admin',
        scopeKind: 'jd_area',
        scopeArea: '80-89',
        expiresAt: new Date(scene.world.adapters.clock.now().getTime() + 60_000),
      },
    ]);
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    await expectNothingRecorded(scene, lapsing, 'not_permitted');
  });
});

describe('GH-6 a recovery takes a stuck parking only after the timeout, and once', () => {
  sceneIt('answers no items when no parking is stuck', async (scene) => {
    scene.world.adapters.clock.advance(sixteenMinutes);
    expect(await recoverAs(scene, scene.ian)).toEqual({ status: 'accepted', value: { items: [] } });
  });

  sceneIt('leaves a stuck parking alone inside the timeout', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(14 * 60_000);
    const before = await logOf(scene);
    expect(await recoverAs(scene, scene.ian)).toEqual({ status: 'accepted', value: { items: [] } });
    expect(await logOf(scene)).toEqual(before);
  });

  sceneIt('does not touch an approval whose connector result was recorded', async (scene) => {
    scene.world.adapters.connectors.refuseNext('merge', 'head_mismatch');
    expect(await decide(scene, scene.world.kernel, 'approve')).toMatchObject({
      status: 'accepted',
      value: { advanced: false },
    });
    scene.world.adapters.clock.advance(sixteenMinutes);
    const before = await logOf(scene);
    expect(await recoverAs(scene, scene.ian)).toEqual({ status: 'accepted', value: { items: [] } });
    expect(await logOf(scene)).toEqual(before);
  });

  sceneIt('records one outcome when two recoveries run one after the other', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    const first = await recoverAs(scene, scene.ian);
    expect(first).toMatchObject({ value: { items: [{ outcome: 'succeeded' }] } });
    expect(await recoverAs(scene, scene.ian)).toEqual({ status: 'accepted', value: { items: [] } });
    const connectorEvents = (await logOf(scene)).events.filter((event) =>
      event.name.startsWith('connector_'),
    );
    expect(connectorEvents.map((event) => event.name)).toEqual(['connector_succeeded']);
  });
});

describe('GH-6 a recovery that cannot read GitHub records nothing', () => {
  sceneIt('refuses and records nothing when the outcome read throws', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    const kernel = withConnectors(scene, {
      run: (request) => scene.world.adapters.connectors.run(request),
      outcomeOf: () => Promise.reject(new TypeError('socket closed')),
    });
    const before = await logOf(scene);
    expect(await recoverAs(scene, scene.ian, kernel)).toMatchObject({
      status: 'error',
      reason: 'facts_stale',
      detail: { itemId: scene.itemId, why: 'github_unreadable' },
    });
    expect(await logOf(scene)).toEqual(before);
  });

  sceneIt('refuses not_wired and records nothing when the merge is not wired', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    const kernel = withConnectors(scene, {
      run: async () => ({ outcome: 'refused', reason: 'not_wired' }),
      outcomeOf: async () => ({ outcome: 'refused', reason: 'not_wired' }),
    });
    const before = await logOf(scene);
    expect(await recoverAs(scene, scene.ian, kernel)).toMatchObject({
      status: 'error',
      reason: 'not_wired',
    });
    expect(await logOf(scene)).toEqual(before);
  });

  sceneIt('refuses and records nothing when GitHub answers a failure', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    const kernel = withConnectors(scene, {
      run: (request) => scene.world.adapters.connectors.run(request),
      outcomeOf: async () => ({ outcome: 'refused', reason: 'github_unavailable' }),
    });
    const before = await logOf(scene);
    expect(await recoverAs(scene, scene.ian, kernel)).toMatchObject({
      status: 'error',
      reason: 'facts_stale',
    });
    expect(await logOf(scene)).toEqual(before);
  });
});

function blindToFlight(scene: Scene): Kernel {
  const { store } = scene.world.adapters;
  return createKernel({
    ...scene.world.adapters,
    store: {
      transaction: (work) =>
        store.transaction((tx) => {
          const { page } = tx.harnessEvents.read;
          Object.assign(tx.harnessEvents.read, {
            page: async (query: Parameters<typeof page>[0]) => {
              const found = await page(query);
              const events = found.events.filter((event) => event.name !== 'gate_approved');
              return { ...found, events };
            },
          });
          return work(tx);
        }),
      appliedMigrations: () => store.appliedMigrations(),
    },
  });
}

async function resubmittedPastTheApproval(scene: Scene): Promise<void> {
  const blind = blindToFlight(scene);
  expect(await decide(scene, blind, 'take_over')).toMatchObject({ status: 'accepted' });
  giveFacts(scene.world, scene.itemId, movedHead, 9100000102);
  const submitted = await blind.items.submit(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: { pullRequest: standardChange.pullRequest, head: movedHead },
  });
  expect(submitted).toMatchObject({
    status: 'accepted',
    value: { item: { gateStatus: 'parked', expectedHead: movedHead } },
  });
}

describe('GH-6 a recovery never advances past a gate the item has not passed', () => {
  sceneIt(
    'records the merge of the head the approval saw, but no stage exit, after a resubmit',
    async (scene) => {
      await lostApproval(scene, true);
      await resubmittedPastTheApproval(scene);
      scene.world.adapters.clock.advance(sixteenMinutes);
      const before = await logOf(scene);
      expect(await recoverAs(scene, scene.ian)).toEqual({
        status: 'accepted',
        value: { items: [{ itemId: scene.itemId, outcome: 'succeeded' }] },
      });
      expect(namesSince(before, await logOf(scene))).toEqual(['connector_succeeded']);
      const asked = scene.world.adapters.connectors.calls().map((call) => call.expectedHead);
      expect(asked).toEqual([head]);
      const row = await scene.world.adapters.store.transaction((tx) =>
        tx.harnessItems.read.byId(scene.itemId),
      );
      expect(row).toMatchObject({
        stageKey: 'ship',
        gateStatus: 'parked',
        expectedHead: movedHead,
      });
    },
  );
});

async function loopApprovedAtShip(scene: Scene): Promise<void> {
  const ian = simCaller(scene.world, scene.ian);
  expect(await decide(scene, scene.world.kernel, 'take_over')).toMatchObject({
    status: 'accepted',
  });
  const edited = await scene.world.kernel.stages.updateStage(ian, {
    harnessId: scene.harnessId,
    stageKey: 'ship',
    change: { feeds: ['scope'] },
  });
  expect(edited.status).toBe('accepted');
  const submitted = await scene.world.kernel.items.submit(ian, {
    itemId: scene.itemId,
    to: 'scope',
    evidence: {},
    change: null,
  });
  expect(submitted).toMatchObject({ value: { item: { gateTarget: 'scope' } } });
  expect(await decide(scene, scene.world.kernel, 'approve')).toMatchObject({
    value: { item: { stageKey: 'scope' } },
  });
}

describe('GH-6 a recovery takes only approvals that waited on a connector', () => {
  sceneIt('leaves a loop approval at a connector stage alone', async (scene) => {
    await loopApprovedAtShip(scene);
    scene.world.adapters.clock.advance(sixteenMinutes);
    const before = await logOf(scene);
    expect(await recoverAs(scene, scene.ian)).toEqual({ status: 'accepted', value: { items: [] } });
    expect(await logOf(scene)).toEqual(before);
  });
});

function slowMerge(scene: Scene) {
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => void (release = resolve));
  const running = new Promise<void>((resolve) => void (started = resolve));
  const kernel = withConnectors(scene, {
    run: async (request) => {
      const outcome = await scene.world.adapters.connectors.run(request);
      started();
      await opened;
      return outcome;
    },
    outcomeOf: async () => null,
  });
  return { kernel, running, release };
}

describe('GH-6 a recovery and the late exit record one outcome between them', () => {
  sceneIt('records nothing from an exit that reports after the recovery', async (scene) => {
    const slow = slowMerge(scene);
    const deciding = decide(scene, slow.kernel, 'approve');
    await slow.running;
    scene.world.adapters.clock.advance(sixteenMinutes);
    expect(await recoverAs(scene, scene.ian)).toMatchObject({
      value: { items: [{ outcome: 'succeeded' }] },
    });
    slow.release();
    expect(await deciding).toMatchObject({ value: { advanced: false } });
    const { events } = await logOf(scene);
    const names = events.map((event) => event.name);
    expect(names.filter((name) => name.startsWith('connector_'))).toEqual(['connector_succeeded']);
    const shipExits = events.filter((event) => event.evidence['from'] === 'ship');
    expect(shipExits.map((event) => event.name)).toEqual(['stage_advanced']);
  });
});

describe('GH-6 a recovery records connector_lost when the request could never have merged', () => {
  sceneIt('records connector_lost for a request the connector refuses outright', async (scene) => {
    await lostApproval(scene, true);
    scene.world.adapters.clock.advance(sixteenMinutes);
    const kernel = withConnectors(scene, {
      run: (request) => scene.world.adapters.connectors.run(request),
      outcomeOf: async () => ({ outcome: 'refused', reason: 'repository_mismatch' }),
    });
    expect(await recoverAs(scene, scene.ian, kernel)).toEqual({
      status: 'accepted',
      value: { items: [{ itemId: scene.itemId, outcome: 'lost' }] },
    });
    const last = (await logOf(scene)).events.at(-1);
    expect([last?.name, last?.evidence]).toEqual([
      'connector_refused',
      { connector: 'merge', reason: 'connector_lost' },
    ]);
  });
});

describe('GH-6 a recovery re-reads the admin grant before it records', () => {
  sceneIt(
    'refuses and records nothing when the admin is revoked during the read',
    async (scene) => {
      const kim = await simPerson(scene.world, 3, [
        { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      await lostApproval(scene, true);
      scene.world.adapters.clock.advance(sixteenMinutes);
      const kernel = withConnectors(scene, {
        run: (request) => scene.world.adapters.connectors.run(request),
        outcomeOf: async (request) => {
          const kimGrant = '00000000-0000-4000-8000-000000020300';
          await revokeSeededGrant(
            scene.world.database.db,
            kimGrant,
            scene.world.adapters.clock.now(),
          );
          return scene.world.adapters.connectors.outcomeOf(request);
        },
      });
      const before = await logOf(scene);
      expect(await recoverAs(scene, kim, kernel)).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
      });
      expect(await logOf(scene)).toEqual(before);
    },
  );
});

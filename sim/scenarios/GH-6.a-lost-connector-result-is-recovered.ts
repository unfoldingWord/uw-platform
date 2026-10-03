import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type Kernel } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { kernelThatLosesTheExit } from '../lost-exit.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simParkedAtShip,
  simSha,
  standardChange,
  type ShipChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

const sixteenMinutes = 16 * 60_000;

const changeB: ShipChange = {
  ...standardChange,
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 43 },
  head: simSha('bbb222'),
};

async function parked(scene: Scene, title: string, change: ShipChange): Promise<string> {
  const { world } = scene;
  const item = await simParkedAtShip(world, {
    harnessId: scene.harnessId,
    editor: scene.max,
    title,
    change,
  });
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', change.head, 9100000101)];
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId: item.itemId, head: change.head, reviews, ref: change.pullRequest }),
  );
  return item.itemId;
}

function approve(scene: Scene, kernel: Kernel, itemId: string) {
  return kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
}

function recover(scene: Scene) {
  return scene.world.kernel.gates.recoverConnectors(simCaller(scene.world, scene.ian), {
    harnessId: scene.harnessId,
  });
}

async function lostApproval(scene: Scene, itemId: string, effectHappened: boolean) {
  const losing = kernelThatLosesTheExit(scene.world, { effectHappened });
  await assert.rejects(approve(scene, losing, itemId), { name: 'ExitLost' });
  const log = await itemLog(scene.world, scene.harnessId, itemId);
  assert.equal(log.events.at(-1)?.name, 'gate_approved');
  const again = await approve(scene, scene.world.kernel, itemId);
  assert.equal(again.status === 'error' && again.reason, 'decision_in_flight');
}

async function recoveredMerge(scene: Scene, itemId: string): Promise<void> {
  await lostApproval(scene, itemId, true);
  assert.deepEqual(await recover(scene), { status: 'accepted', value: { items: [] } });
  scene.world.adapters.clock.advance(sixteenMinutes);
  const recovered = await recover(scene);
  assert.deepEqual(recovered, {
    status: 'accepted',
    value: { items: [{ itemId, outcome: 'succeeded' }] },
  });
  const log = await itemLog(scene.world, scene.harnessId, itemId);
  assert.deepEqual(
    log.events.slice(-2).map((event) => [event.name, event.evidence]),
    [
      ['connector_succeeded', { connector: 'merge', detail: {} }],
      ['stage_advanced', { from: 'ship', to: 'validate' }],
    ],
  );
}

async function recoveredLoss(scene: Scene, itemId: string): Promise<void> {
  await lostApproval(scene, itemId, false);
  scene.world.adapters.clock.advance(sixteenMinutes);
  const recovered = await recover(scene);
  assert.deepEqual(recovered, {
    status: 'accepted',
    value: { items: [{ itemId, outcome: 'lost' }] },
  });
  const log = await itemLog(scene.world, scene.harnessId, itemId);
  assert.equal(log.events.at(-1)?.name, 'connector_refused');
  assert.deepEqual(log.events.at(-1)?.evidence, { connector: 'merge', reason: 'connector_lost' });
  const row = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.byId(itemId),
  );
  assert.equal(row?.stageKey, 'ship');
  assert.equal(row?.gateStatus, 'parked');
  const fresh = await approve(scene, scene.world.kernel, itemId);
  assert.equal(fresh.status, 'accepted');
}

async function outcomeOf(scene: Scene, itemId: string) {
  const log = await itemLog(scene.world, scene.harnessId, itemId);
  const recorded = log.events.filter((event) => event.name.startsWith('connector_'));
  return { connectorEvents: recorded.map((event) => event.name), decisions: log.decisions };
}

export const scenario = defineScenario({
  id: 'GH-6',
  title:
    'a connector result lost after the merge ran is recovered by an admin after the timeout: a merge that happened is recorded and the item advances, a merge that did not is recorded connector_lost and the item stays parked for a fresh approval',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const scene = { world, harnessId: harness.id, ian: admin, max };
    const itemA = await parked(scene, 'Show the board', standardChange);
    await recoveredMerge(scene, itemA);
    const itemB = await parked(scene, 'Sort the board', changeB);
    await recoveredLoss(scene, itemB);
    return { state: { a: await outcomeOf(scene, itemA), b: await outcomeOf(scene, itemB) } };
  },
});

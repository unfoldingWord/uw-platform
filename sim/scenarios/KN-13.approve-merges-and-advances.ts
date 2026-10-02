import assert from 'node:assert/strict';
import type { ItemState, Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  shipPullRequest,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

async function parkedAtShip(world: World): Promise<Scene> {
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
  return { world, harnessId: harness.id, itemId: parked.itemId, ian: admin, max };
}

async function approveAndMerge(scene: Scene): Promise<void> {
  const { world, harnessId, itemId } = scene;
  world.adapters.githubFacts.given(
    greenFacts(world, 'abc123', [approvedBy('uw-reviewer', 'anthropic', 'abc123')]),
  );
  const before = await itemLog(world, harnessId, itemId);
  const approved = valueOf(
    await world.kernel.gates.decide(simCaller(world, scene.ian), {
      itemId,
      decision: 'approve',
      reason: null,
      findings: [],
    }),
  );
  assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
  assert.equal(approved.advanced, true);
  assert.equal(approved.item.stageKey, 'validate');
  assert.equal(approved.item.gateStatus, 'working');
  const after = await itemLog(world, harnessId, itemId);
  assert.deepEqual(after.decisions, ['approve']);
  assert.deepEqual(namesSince(before, after), [
    'gate_approved',
    'connector_succeeded',
    'stage_advanced',
  ]);
  assert.deepEqual(after.events.at(-2)?.evidence, { connector: 'merge', detail: {} });
  assert.deepEqual(after.events.at(-1)?.evidence, { from: 'ship', to: 'validate' });
  const calls = world.adapters.connectors.calls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    connector: 'merge',
    harnessId,
    itemId,
    traceId: after.events.at(-1)?.traceId,
    pullRequest: shipPullRequest,
    expectedHead: 'abc123',
    message: 'Show the board',
  });
}

async function passStage(scene: Scene): Promise<ItemState> {
  const caller = simCaller(scene.world, scene.max);
  const { items } = scene.world.kernel;
  valueOf(await items.claim(caller, { itemId: scene.itemId, delegationId: null }));
  const submitted = await items.submit(caller, {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: null,
  });
  return valueOf(submitted).item;
}

async function validateAndClose(scene: Scene): Promise<ItemState> {
  const atClose = await passStage(scene);
  assert.equal(atClose.stageKey, 'close');
  const pageId = '00000000-0000-4000-8000-000000070001';
  await seedPage(scene.world.database.db, {
    id: pageId,
    type: 'learning',
    status: 'suggested',
    jdArea: '80-89',
    bodyMd: '- [observed] the board renders from the stage rows',
    slug: 'learning-board',
    title: 'The board renders from the stage rows',
  });
  valueOf(
    await scene.world.kernel.items.attachLearning(simCaller(scene.world, scene.max), {
      itemId: scene.itemId,
      pageId,
    }),
  );
  const done = await passStage(scene);
  assert.equal(done.gateStatus, 'done');
  return done;
}

export const scenario = defineScenario({
  id: 'KN-13',
  title:
    'a person approves at Ship over green facts on the expected head: the decision is recorded, the merge connector runs from the stage exit, and the item goes on through Validate and Close to done',
  run: async (world) => {
    const scene = await parkedAtShip(world);
    await approveAndMerge(scene);
    const done = await validateAndClose(scene);
    const { decisions } = await itemLog(world, scene.harnessId, scene.itemId);
    return { state: { gateStatus: done.gateStatus, decisions, merges: 1 } };
  },
});

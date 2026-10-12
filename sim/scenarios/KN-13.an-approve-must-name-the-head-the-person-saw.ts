import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simParkedAtShip,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
};

const headA = standardChange.head;
const headB = simSha('b0b');

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

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
  return { world, harnessId: harness.id, itemId: parked.itemId, ian: admin };
}

async function headSeenInTheView(scene: Scene): Promise<string | null> {
  const caller = simCaller(scene.world, scene.ian);
  return valueOf(await scene.world.kernel.gates.view(caller, { itemId: scene.itemId }))
    .expectedHead;
}

async function moveTheHead(scene: Scene): Promise<void> {
  const caller = simCaller(scene.world, scene.ian);
  const { world, itemId } = scene;
  const { gates, items } = world.kernel;
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', headB, 9100000102)];
  world.adapters.githubFacts.given(greenFacts(world, { itemId, head: headB, reviews }));
  const decision = { itemId: scene.itemId, reason: null, findings: [] };
  valueOf(await gates.decide(caller, { ...decision, decision: 'take_over' }));
  const submitted = valueOf(
    await items.submit(caller, {
      itemId: scene.itemId,
      to: null,
      evidence: {},
      change: { pullRequest: standardChange.pullRequest, head: headB },
    }),
  );
  assert.equal(submitted.item.gateStatus, 'parked');
  assert.equal(submitted.item.expectedHead, headB);
}

function approveSeeing(scene: Scene, seenHead: string | null) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead,
  });
}

async function refusesTheOldHead(scene: Scene, seen: string | null): Promise<void> {
  const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
  const outcome = await approveSeeing(scene, seen);
  assert.deepEqual(outcome, {
    status: 'error',
    reason: 'head_mismatch',
    detail: { why: 'not_the_head_you_saw', expectedHead: headB },
  });
  assert.deepEqual(await itemLog(scene.world, scene.harnessId, scene.itemId), before);
  assert.deepEqual(before.decisions, ['take_over']);
  assert.deepEqual(scene.world.adapters.connectors.calls(), []);
}

async function approvesTheNewHead(scene: Scene): Promise<void> {
  const { world, itemId } = scene;
  const approved = valueOf(await approveSeeing(scene, await headSeenInTheView(scene)));
  assert.equal(approved.advanced, true);
  assert.equal(approved.item.stageKey, 'validate');
  const after = await itemLog(world, scene.harnessId, itemId);
  assert.deepEqual(after.decisions, ['take_over', 'approve']);
  assert.equal(world.adapters.connectors.calls()[0]?.expectedHead, headB);
}

export const scenario = defineScenario({
  id: 'KN-13',
  title:
    'an approve names the head the person saw: after a new submit moves the expected head, an approve naming the old head is refused head_mismatch and decides nothing, and an approve naming the new head goes on to the ship rule',
  run: async (world) => {
    const scene = await parkedAtShip(world);
    const seen = await headSeenInTheView(scene);
    assert.equal(seen, headA);
    await moveTheHead(scene);
    await refusesTheOldHead(scene, seen);
    await approvesTheNewHead(scene);
    assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
    const { decisions } = await itemLog(world, scene.harnessId, scene.itemId);
    return { state: { decisions, merges: world.adapters.connectors.calls().length } };
  },
});

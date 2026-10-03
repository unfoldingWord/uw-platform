import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simCaller, simPerson, simSeenHead } from '../fixtures.ts';
import { kernelThatLosesTheExit } from '../lost-exit.ts';
import { defineScenario } from '../scenario.ts';
import { approvedBy, greenFacts, simParkedAtShip, standardChange } from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Scene = { readonly world: World; readonly harnessId: string; readonly ian: Principal };

const sixteenMinutes = 16 * 60_000;

function unshipped(scene: Scene) {
  return scene.world.kernel.stages.updateStage(simCaller(scene.world, scene.ian), {
    harnessId: scene.harnessId,
    stageKey: 'ship',
    change: { connector: 'none', exitGate: 'checks' },
  });
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'accepted' ? 'accepted' : outcome.reason;
}

async function waitingApproval(scene: Scene, max: Principal): Promise<string> {
  const { world } = scene;
  const item = await simParkedAtShip(world, {
    harnessId: scene.harnessId,
    editor: max,
    title: 'Show the board',
    change: standardChange,
  });
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', standardChange.head, 9100000101)];
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }),
  );
  const losing = kernelThatLosesTheExit(world, { effectHappened: true });
  const seenHead = await simSeenHead(world, item.itemId);
  const approval = losing.gates.decide(simCaller(world, scene.ian), {
    itemId: item.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead,
  });
  await assert.rejects(approval, { name: 'ExitLost' });
  return item.itemId;
}

async function shipStage(scene: Scene) {
  const stages = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(scene.harnessId),
  );
  const ship = stages.find((stage) => stage.key === 'ship');
  return { connector: ship?.connector, exitGate: ship?.exitGate };
}

export const scenario = defineScenario({
  id: 'KN-18',
  title:
    "a stage's connector cannot change while an approval at that stage waits for its connector outcome, and can once recovery records the outcome",
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const scene = { world, harnessId: harness.id, ian: admin };
    const itemId = await waitingApproval(scene, max);
    const waiting = await unshipped(scene);
    assert.equal(reasonOf(waiting), 'decision_in_flight');
    assert.deepEqual(await shipStage(scene), { connector: 'merge', exitGate: 'human_approval' });
    world.adapters.clock.advance(sixteenMinutes);
    const recovered = await world.kernel.gates.recoverConnectors(simCaller(world, admin), {
      harnessId: harness.id,
    });
    assert.deepEqual(recovered, {
      status: 'accepted',
      value: { items: [{ itemId, outcome: 'succeeded' }] },
    });
    const after = await unshipped(scene);
    assert.equal(reasonOf(after), 'accepted');
    assert.deepEqual(await shipStage(scene), { connector: 'none', exitGate: 'checks' });
    return { state: { waiting: reasonOf(waiting), after: reasonOf(after) } };
  },
});

import assert from 'node:assert/strict';
import type { GateDecision, HarnessEvent, Principal } from '@uw/contracts';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simParkedAtCheck, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly builder: Caller;
};

const submitInput = (itemId: string) => ({ itemId, to: null, evidence: {}, change: null });

async function cast(world: World): Promise<Cast> {
  const { harness, admin } = await createSimHarness(world, software);
  const max = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const parked = await simParkedAtCheck(world, {
    harnessId: harness.id,
    admin,
    title: 'Migrate the board',
  });
  const builder = simCaller(world, simAgent(max, `${max.personId}/builder`, { interactive: true }));
  return { world, harnessId: harness.id, itemId: parked.itemId, ian: admin, builder };
}

async function decide(scene: Cast, decision: GateDecision, findings: readonly string[] = []) {
  const outcome = await scene.world.kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision,
    reason: null,
    findings,
  });
  const { drift } = await readWorldLog(scene.world.adapters.store);
  assert.deepEqual(drift, [], `the projection drifted after ${decision}`);
  return outcome;
}

function eventsOf(scene: Cast): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
}

async function decisionsOf(scene: Cast): Promise<readonly GateDecision[]> {
  const rows = await scene.world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(scene.itemId),
  );
  return rows.map((row) => row.decision);
}

async function rejectWithFindings(scene: Cast): Promise<void> {
  const findings = ['the migration has no down path'];
  const rejected = valueOf(await decide(scene, 'reject', findings));
  assert.equal(rejected.advanced, false);
  assert.equal(rejected.item.stageKey, 'check');
  assert.equal(rejected.item.gateStatus, 'working');
  assert.equal(rejected.item.holder, null);
  assert.deepEqual(await decisionsOf(scene), ['reject']);
  const last = (await eventsOf(scene)).at(-1);
  assert.ok(last);
  assert.equal(last.name, 'gate_rejected');
  assert.deepEqual(last.evidence, { decisionId: rejected.decisionId, stage: 'check', findings });
}

async function agentParksAgain(scene: Cast): Promise<void> {
  const { world, itemId, builder } = scene;
  valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  const parked = valueOf(await world.kernel.items.submit(builder, submitInput(itemId)));
  assert.equal(parked.result, 'parked');
}

async function takeOverAndApprove(scene: Cast): Promise<void> {
  const taken = valueOf(await decide(scene, 'take_over'));
  assert.equal(taken.item.holder, scene.ian.identity);
  assert.equal(taken.item.claimantKind, 'person');
  assert.equal(taken.item.leaseExpiresAt, null);
  assert.equal(taken.item.gateStatus, 'working');
  assert.deepEqual(await decisionsOf(scene), ['reject', 'take_over']);
  const ian = simCaller(scene.world, scene.ian);
  const resubmitted = valueOf(
    await scene.world.kernel.items.submit(ian, submitInput(scene.itemId)),
  );
  assert.equal(resubmitted.result, 'parked');
  const approved = valueOf(await decide(scene, 'approve'));
  assert.equal(approved.advanced, true);
  assert.equal(approved.item.stageKey, 'ship');
  assert.equal(approved.item.gateStatus, 'working');
  const names = (await eventsOf(scene)).map((event) => event.name);
  assert.deepEqual(names.slice(-2), ['gate_approved', 'stage_advanced']);
  assert.deepEqual(await decisionsOf(scene), ['reject', 'take_over', 'approve']);
}

export const scenario = defineScenario({
  id: 'KN-13',
  title:
    'a person rejects with findings, takes over an agent-parked item so that they hold it without a lease, and approves it on to Ship, each a recorded gate decision',
  run: async (world) => {
    const scene = await cast(world);
    await rejectWithFindings(scene);
    await agentParksAgain(scene);
    await takeOverAndApprove(scene);
    return { state: { decisions: await decisionsOf(scene) } };
  },
});

import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import {
  createSimHarness,
  simAgent,
  simCaller,
  simIan,
  simPerson,
  simSystem,
} from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const minute = 60_000;

type Cast = {
  readonly harnessId: string;
  readonly itemId: string;
  readonly editor: Principal;
  readonly laptop: Caller;
};

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'error' ? outcome.reason : 'accepted';
}

async function namesOf(world: World, cast: Cast): Promise<string[]> {
  const events = await world.adapters.store.transaction((tx) =>
    readAllEvents(tx, cast.harnessId, cast.itemId),
  );
  return events.map((event) => event.name);
}

function laptopOf(world: World, owner: Principal, device: string): Caller {
  return simCaller(
    world,
    simAgent(owner, `${owner.personId ?? ''}/${device}`, { interactive: true }),
  );
}

async function cast(world: World): Promise<Cast> {
  const { harness, admin } = await createSimHarness(world, software);
  valueOf(
    await world.kernel.stages.updateStage(simCaller(world, admin), {
      harnessId: harness.id,
      stageKey: 'package',
      change: { agentPickup: 'allowed' },
    }),
  );
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const { itemId } = valueOf(
    await world.kernel.items.enqueue(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      title: 'Write the run host notes',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  return { harnessId: harness.id, itemId, editor, laptop: laptopOf(world, editor, 'laptop') };
}

async function twoSteps(world: World, scene: Cast, runId: string): Promise<void> {
  for (const tokensIn of [1800, 2400]) {
    valueOf(
      await world.kernel.items.recordRunStep(scene.laptop, {
        itemId: scene.itemId,
        runId,
        step: 'work',
        tokensIn,
        tokensOut: 400,
        costBasis: 'subscription',
      }),
    );
  }
}

async function runOf(world: World, runId: string) {
  return world.adapters.store.transaction((tx) => tx.harnessRuns.read.byId(runId));
}

async function headOf(world: World, itemId: string): Promise<string | null> {
  const item = await world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
  return item?.expectedHead ?? null;
}

async function reportedRun(world: World, scene: Cast): Promise<string> {
  valueOf(
    await world.kernel.items.claim(scene.laptop, { itemId: scene.itemId, delegationId: null }),
  );
  const runId = world.adapters.ids.next();
  await twoSteps(world, scene, runId);
  const reported = await runOf(world, runId);
  assert.equal(reported?.costBasis, 'subscription');
  assert.equal(reported?.costMinor, null);
  assert.deepEqual(
    reported?.steps.map((step) => step.tokensIn),
    [1800, 2400],
  );
  return runId;
}

async function sweptRun(world: World, scene: Cast, runId: string): Promise<string | undefined> {
  world.adapters.clock.advance(16 * minute);
  const swept = valueOf(
    await world.kernel.items.expireLeases(simCaller(world, simSystem()), { limit: 10 }),
  );
  assert.deepEqual(swept.expired, [scene.itemId]);
  const stopped = await runOf(world, runId);
  assert.equal(stopped?.outcome, 'stopped');
  return stopped?.outcome;
}

async function nextClaimants(world: World, scene: Cast, head: string | null) {
  const second = laptopOf(world, scene.editor, 'desktop');
  const claimed = valueOf(
    await world.kernel.items.claim(second, { itemId: scene.itemId, delegationId: null }),
  );
  assert.equal(claimed.item.expectedHead, head);
  const routine = simCaller(
    world,
    simAgent(scene.editor, `${scene.editor.personId ?? ''}/routine`, { interactive: false }),
  );
  const refused = await world.kernel.items.claim(routine, {
    itemId: scene.itemId,
    delegationId: null,
  });
  assert.equal(reasonOf(refused), 'delegation_required');
  return { holder: claimed.item.holder, unattended: reasonOf(refused) };
}

export const scenario = defineScenario({
  id: 'HE-6',
  title:
    'an external run reports subscription tokens with no cost, ends lease_expired when the sweep expires its lease, and the next claimant starts from the expected head',
  run: async (world) => {
    const scene = await cast(world);
    const runId = await reportedRun(world, scene);
    const head = await headOf(world, scene.itemId);
    const outcome = await sweptRun(world, scene, runId);
    const next = await nextClaimants(world, scene, head);
    assert.deepEqual(await namesOf(world, scene), [
      'item_created',
      'item_claimed',
      'run_started',
      'run_step_recorded',
      'run_step_recorded',
      'lease_expired',
      'run_stopped',
      'item_claimed',
      'delegation_required',
    ]);
    return { state: { run: { outcome, costBasis: 'subscription', steps: 2 }, ...next } };
  },
});

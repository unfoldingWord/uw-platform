import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type Caller, type KernelOutcome } from '@uw/harness';
import {
  createSimHarness,
  simAdvance,
  simAgent,
  simCaller,
  simIan,
  simPerson,
} from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import { greenFacts, itemLog, namesSince, shipPullRequest, simSha } from '../ship-fixtures.ts';
import type { World } from '../world.ts';

const minute = 60_000;
const abandonedHead = simSha('a1');
const pushedTip = simSha('c3');

type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly owner: Principal;
  readonly device: (name: string) => Caller;
};

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function cast(world: World): Promise<Cast> {
  const { harness } = await createSimHarness(world, software);
  valueOf(
    await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      stageKey: 'scope',
      change: { validators: ['learning_attached'] },
    }),
  );
  const owner = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const device = (name: string) =>
    simCaller(world, simAgent(owner, `${owner.personId}/${name}`, { interactive: true }));
  return { world, harnessId: harness.id, owner, device };
}

async function enqueue(scene: Cast, title: string): Promise<string> {
  const outcome = await scene.world.kernel.items.enqueue(simCaller(scene.world, scene.owner), {
    harnessId: scene.harnessId,
    title,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  return valueOf(outcome).itemId;
}

async function heldAtScope(scene: Cast, builder: Caller): Promise<string> {
  const { world, harnessId, owner } = scene;
  const itemId = await enqueue(scene, 'Wire the board');
  await simAdvance(world, { harnessId, itemId, worker: owner, through: ['package'] });
  valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  const submitted = valueOf(
    await world.kernel.items.submit(builder, {
      itemId,
      to: null,
      evidence: {},
      change: { pullRequest: shipPullRequest, head: abandonedHead },
    }),
  );
  assert.equal(submitted.result, 'checks_failed');
  assert.equal(submitted.item.expectedHead, abandonedHead);
  assert.equal(submitted.item.branchState, 'active');
  return itemId;
}

async function claimAfterLapse(
  scene: Cast,
  caller: Caller,
  itemId: string,
  adopt: boolean,
  lapse = 16 * minute,
) {
  scene.world.adapters.clock.advance(lapse);
  const before = await itemLog(scene.world, scene.harnessId, itemId);
  const claimed = valueOf(
    await scene.world.kernel.items.claim(caller, {
      itemId,
      delegationId: null,
      adoptBranch: adopt,
    }),
  );
  const after = await itemLog(scene.world, scene.harnessId, itemId);
  return { claimed, names: namesSince(before, after), events: after.events };
}

async function refusedAdoption(scene: Cast): Promise<void> {
  const itemId = await enqueue(scene, 'Nothing abandoned');
  const before = await itemLog(scene.world, scene.harnessId, itemId);
  const outcome = await scene.world.kernel.items.claim(simCaller(scene.world, scene.owner), {
    itemId,
    delegationId: null,
    adoptBranch: true,
  });
  assert.deepEqual(outcome, {
    status: 'error',
    reason: 'malformed_command',
    detail: { adoptBranch: true, why: 'no_abandoned_branch' },
  });
  assert.deepEqual(await itemLog(scene.world, scene.harnessId, itemId), before);
}

async function declined(scene: Cast, itemId: string): Promise<void> {
  const second = await claimAfterLapse(scene, scene.device('second'), itemId, false);
  assert.deepEqual(second.names, ['lease_expired', 'branch_abandoned', 'item_claimed']);
  const abandoned = second.events.find((event) => event.name === 'branch_abandoned');
  assert.deepEqual(abandoned?.evidence, { head: abandonedHead });
  assert.deepEqual(second.claimed.branch, {
    name: `harness/${itemId}`,
    startFrom: abandonedHead,
    adopted: false,
  });
  assert.equal(second.claimed.item.branchState, 'abandoned');
}

async function adopted(scene: Cast, third: Caller, itemId: string): Promise<void> {
  scene.world.adapters.clock.advance(16 * minute);
  scene.world.adapters.githubFacts.given(
    greenFacts(scene.world, { itemId, head: pushedTip, reviews: [] }),
  );
  const claim = await claimAfterLapse(scene, third, itemId, true, 0);
  assert.deepEqual(claim.names, ['lease_expired', 'item_claimed', 'branch_adopted']);
  const recorded = claim.events.find((event) => event.name === 'branch_adopted');
  assert.deepEqual(recorded?.evidence, { head: pushedTip });
  assert.deepEqual(claim.claimed.branch, {
    name: `harness/${itemId}`,
    startFrom: pushedTip,
    adopted: true,
  });
  assert.equal(claim.claimed.item.branchState, 'active');
  assert.equal(claim.claimed.item.expectedHead, pushedTip);
}

async function abandonedAgain(scene: Cast, fourth: Caller, itemId: string): Promise<void> {
  const claim = await claimAfterLapse(scene, fourth, itemId, false);
  assert.deepEqual(claim.names, ['lease_expired', 'branch_abandoned', 'item_claimed']);
  const abandoned = claim.events.filter((event) => event.name === 'branch_abandoned');
  assert.deepEqual(abandoned.at(-1)?.evidence, { head: pushedTip });
  assert.deepEqual(claim.claimed.branch, {
    name: `harness/${itemId}`,
    startFrom: pushedTip,
    adopted: false,
  });
}

export const scenario = defineScenario({
  id: 'GH-4',
  title:
    'a lapsed lease abandons the branch; the next claim starts from the expected head unless it adopts the branch tip GitHub holds, and adopting is an event',
  run: async (world) => {
    const scene = await cast(world);
    const itemId = await heldAtScope(scene, scene.device('first'));
    await declined(scene, itemId);
    const third = scene.device('third');
    await adopted(scene, third, itemId);
    const fourth = scene.device('fourth');
    await abandonedAgain(scene, fourth, itemId);
    await refusedAdoption(scene);
    const resubmitted = valueOf(
      await world.kernel.items.submit(fourth, {
        itemId,
        to: null,
        evidence: {},
        change: { pullRequest: shipPullRequest, head: simSha('b2') },
      }),
    );
    assert.equal(resubmitted.item.expectedHead, simSha('b2'));
    const { branchState, expectedHead } = resubmitted.item;
    return { state: { branchState, expectedHead } };
  },
});

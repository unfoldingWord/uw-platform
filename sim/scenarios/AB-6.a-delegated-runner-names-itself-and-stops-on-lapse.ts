import assert from 'node:assert/strict';
import {
  delegatedIdentity,
  principalSchema,
  type HarnessEvent,
  type Principal,
} from '@uw/contracts';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import {
  createSimHarness,
  readSpend,
  simAgent,
  simCaller,
  simDelegate,
  simIan,
  simPerson,
} from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const ROUTINE = 'hourly-routine';

type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly kim: Principal;
  readonly editor: Principal;
  readonly itemIds: readonly [string, string, string, string];
};

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'error' ? outcome.reason : 'accepted';
}

function agentNamed(owner: Principal, identity: string, interactive: boolean): Principal {
  return principalSchema.parse({
    identity,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: owner.grants,
    interactive,
  });
}

function routineDevice(kim: Principal): string {
  return `agent:${kim.personId ?? ''}/${ROUTINE}`;
}

async function enqueue(world: World, harnessId: string, n: number): Promise<string> {
  const ian = await simIan(world);
  const outcome = await world.kernel.items.enqueue(simCaller(world, ian), {
    harnessId,
    title: `Routine work ${n.toString()}`,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  return valueOf(outcome).itemId;
}

async function cast(world: World): Promise<Cast> {
  const { harness, admin } = await createSimHarness(world, software);
  await readSpend(world);
  valueOf(
    await world.kernel.stages.updateStage(simCaller(world, admin), {
      harnessId: harness.id,
      stageKey: 'package',
      change: { agentPickup: 'allowed', bracket: 'iterate' },
    }),
  );
  const kim = await simPerson(world, 4, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const editor = await simPerson(world, 5, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const itemIds = [
    await enqueue(world, harness.id, 1),
    await enqueue(world, harness.id, 2),
    await enqueue(world, harness.id, 3),
    await enqueue(world, harness.id, 4),
  ] as const;
  return { world, harnessId: harness.id, kim, editor, itemIds };
}

async function delegate(scene: Cast): Promise<string> {
  const granted = await simDelegate(scene.world, scene.kim, {
    harnessId: scene.harnessId,
    persona: 'agent:iterate',
    capability: 'iterate',
    expiresAt: null,
    supersedes: null,
  });
  return valueOf(granted).id;
}

async function harnessLog(scene: Cast): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harnessId, null));
}

async function itemLog(scene: Cast, itemId: string): Promise<readonly HarnessEvent[]> {
  return (await harnessLog(scene)).filter((event) => event.itemId === itemId);
}

async function lapseEvents(scene: Cast, delegationId: string): Promise<readonly HarnessEvent[]> {
  const log = await harnessLog(scene);
  return log.filter(
    (event) =>
      event.name === 'delegation_lapsed' && event.evidence['delegationId'] === delegationId,
  );
}

async function lapsesOf(scene: Cast, delegationId: string): Promise<number> {
  return (await lapseEvents(scene, delegationId)).length;
}

function step(caller: Caller, scene: Cast, itemId: string) {
  return scene.world.kernel.items.recordRunStep(caller, {
    itemId,
    runId: scene.world.adapters.ids.next(),
    step: 'work',
    tokensIn: 10,
    tokensOut: 5,
    costBasis: 'subscription',
  });
}

function submit(caller: Caller, scene: Cast, itemId: string) {
  return scene.world.kernel.items.submit(caller, { itemId, to: null, evidence: {}, change: null });
}

async function deviceWithoutDelegation(scene: Cast): Promise<void> {
  const [first] = scene.itemIds;
  const device = simCaller(scene.world, agentNamed(scene.kim, routineDevice(scene.kim), false));
  const refused = await scene.world.kernel.items.claim(device, {
    itemId: first,
    delegationId: null,
  });
  assert.equal(reasonOf(refused), 'delegation_required');
  const names = (await itemLog(scene, first)).map((event) => event.name);
  assert.equal(names.at(-1), 'delegation_required');
}

async function delegatedRun(scene: Cast, caller: Caller, delegationId: string): Promise<void> {
  const [first] = scene.itemIds;
  const { claim } = scene.world.kernel.items;
  const unnamed = await claim(caller, { itemId: first, delegationId: null });
  assert.deepEqual(unnamed, {
    status: 'error',
    reason: 'not_permitted',
    detail: { delegationId: null, why: 'delegation_mismatch' },
  });
  const before = (await itemLog(scene, first)).length;
  const claimed = valueOf(await claim(caller, { itemId: first, delegationId }));
  assert.equal(claimed.item.holder, caller.actor.identity);
  assert.equal(reasonOf(await step(caller, scene, first)), 'accepted');
  const submitted = valueOf(await submit(caller, scene, first));
  assert.equal(submitted.item.stageKey, 'scope');
  const written = (await itemLog(scene, first)).slice(before);
  assert.deepEqual(
    written.map((event) => event.name).filter((name) => name === 'run_step_recorded'),
    ['run_step_recorded'],
  );
  assert.ok(written.length >= 3);
  for (const event of written) assert.equal(event.actor, caller.actor.identity);
}

async function lapsedRun(scene: Cast, caller: Caller, delegationId: string): Promise<void> {
  const [, second] = scene.itemIds;
  valueOf(await scene.world.kernel.items.claim(caller, { itemId: second, delegationId }));
  valueOf(
    await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.kim), {
      delegationId,
    }),
  );
  assert.equal(reasonOf(await step(caller, scene, second)), 'delegation_lapsed');
  const lapsedBy = [caller.actor.identity];
  const actors = async () => (await lapseEvents(scene, delegationId)).map((event) => event.actor);
  assert.deepEqual(await actors(), lapsedBy);
  assert.equal(reasonOf(await submit(caller, scene, second)), 'delegation_lapsed');
  assert.deepEqual(await actors(), lapsedBy);
}

async function interactiveClaim(scene: Cast): Promise<void> {
  const [, , third] = scene.itemIds;
  const laptop = agentNamed(scene.editor, `agent:${scene.editor.personId ?? ''}/laptop`, true);
  const claimed = valueOf(
    await scene.world.kernel.items.claim(simCaller(scene.world, laptop), {
      itemId: third,
      delegationId: null,
    }),
  );
  assert.equal(claimed.item.holder, laptop.identity);
}

async function hostedBeat(scene: Cast): Promise<void> {
  const [, , , fourth] = scene.itemIds;
  const delegationId = await delegate(scene);
  const persona = simCaller(scene.world, simAgent(scene.kim, 'iterate', { interactive: false }));
  const beat = valueOf(await scene.world.kernel.delegations.beat(persona, { delegationId }));
  assert.equal(beat.principal.identity, 'agent:iterate');
  const hosted = simCaller(scene.world, beat.principal);
  valueOf(await scene.world.kernel.items.claim(hosted, { itemId: fourth, delegationId }));
  const claimed = (await itemLog(scene, fourth)).filter((event) => event.name === 'item_claimed');
  assert.deepEqual(
    claimed.map((event) => [event.actor, event.evidence['delegationId']]),
    [['agent:iterate', delegationId]],
  );
}

export const scenario = defineScenario({
  id: 'AB-6',
  title:
    'a non-interactive runner claims only under a live delegation, names it on every event, and stops with one delegation_lapsed when it is revoked',
  run: async (world) => {
    const scene = await cast(world);
    await deviceWithoutDelegation(scene);
    const delegationId = await delegate(scene);
    const identity = delegatedIdentity(routineDevice(scene.kim), 'iterate', delegationId);
    const runner = simCaller(world, agentNamed(scene.kim, identity, false));
    await delegatedRun(scene, runner, delegationId);
    await lapsedRun(scene, runner, delegationId);
    await interactiveClaim(scene);
    await hostedBeat(scene);
    return { state: { lapsed: await lapsesOf(scene, delegationId) } };
  },
});

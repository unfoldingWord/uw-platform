import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type Caller, type KernelOutcome, type PollItem } from '@uw/harness';
import type { World } from '../world.ts';
import {
  createSimHarness,
  simAgent,
  simCaller,
  simIan,
  simParkedAtCheck,
  simPerson,
} from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

const minute = 60_000;

type Cast = {
  readonly world: World;
  readonly firstId: string;
  readonly secondId: string;
  readonly ian: Principal;
  readonly editor: Principal;
};

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function device(world: World, owner: Principal, name: string): Caller {
  return simCaller(
    world,
    simAgent(owner, `${owner.personId ?? ''}/${name}`, { interactive: true }),
  );
}

async function enqueue(world: World, harnessId: string, priority: number): Promise<string> {
  const outcome = await world.kernel.items.enqueue(simCaller(world, await simIan(world)), {
    harnessId,
    title: `Priority ${priority.toString()}`,
    pageId: null,
    priority,
    due: null,
    delegationId: null,
  });
  return valueOf(outcome).itemId;
}

async function cast(world: World): Promise<Cast> {
  const first = await createSimHarness(world, software);
  const second = await createSimHarness(world, software, { key: 'software-two', jdArea: '30-39' });
  valueOf(
    await world.kernel.stages.updateStage(simCaller(world, first.admin), {
      harnessId: first.harness.id,
      stageKey: 'package',
      change: { agentPickup: 'allowed' },
    }),
  );
  const editor = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  return {
    world,
    firstId: first.harness.id,
    secondId: second.harness.id,
    ian: first.admin,
    editor,
  };
}

async function poll(world: World, caller: Caller, limit: number): Promise<readonly PollItem[]> {
  return valueOf(await world.kernel.reads.poll(caller, { harnessId: null, limit }));
}

async function idsPolled(world: World, caller: Caller): Promise<readonly string[]> {
  return (await poll(world, caller, 10)).map((item) => item.itemId);
}

async function claimAndLapse(scene: Cast, laptop: Caller, expected: readonly string[]) {
  const { world } = scene;
  const [, , five] = expected;
  if (five === undefined) throw new Error('the priority-5 item is missing');
  const builder = device(world, scene.editor, 'builder');
  valueOf(await world.kernel.items.claim(builder, { itemId: five, delegationId: null }));
  assert.deepEqual(
    await idsPolled(world, laptop),
    expected.filter((id) => id !== five),
  );
  world.adapters.clock.advance(16 * minute);
  assert.deepEqual(await idsPolled(world, laptop), expected);
}

async function othersPollNothing(scene: Cast): Promise<void> {
  const { world } = scene;
  const viewer = await simPerson(world, 3, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  assert.deepEqual(await idsPolled(world, device(world, viewer, 'laptop')), []);
  const secondEditor = await simPerson(world, 4, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  assert.deepEqual(await idsPolled(world, device(world, secondEditor, 'laptop')), []);
}

export const scenario = defineScenario({
  id: 'AB-4',
  title:
    'poll returns the unheld items in agent-pickup stages of the harnesses the caller may write, by priority then id',
  run: async (world) => {
    const scene = await cast(world);
    const [five, nineA, one, nineB] = [
      await enqueue(world, scene.firstId, 5),
      await enqueue(world, scene.firstId, 9),
      await enqueue(world, scene.firstId, 1),
      await enqueue(world, scene.firstId, 9),
    ];
    await enqueue(world, scene.secondId, 9);
    const nines = [nineA, nineB].sort();
    const expected = [...nines, five, one];
    const laptop = device(world, scene.editor, 'laptop');
    const polled = await poll(world, laptop, 10);
    assert.deepEqual(
      polled.map((item) => [item.itemId, item.harnessId, item.stage]),
      expected.map((id) => [id, scene.firstId, 'package']),
    );
    assert.deepEqual(
      polled.map((item) => item.priority),
      [9, 9, 5, 1],
    );
    await claimAndLapse(scene, laptop, expected);
    await simParkedAtCheck(world, { harnessId: scene.firstId, admin: scene.ian, title: 'Parked' });
    assert.deepEqual(await idsPolled(world, laptop), expected);
    await othersPollNothing(scene);
    const two = await poll(world, laptop, 2);
    assert.deepEqual(
      two.map((item) => item.itemId),
      nines,
    );
    return { state: { polled: polled.length } };
  },
});

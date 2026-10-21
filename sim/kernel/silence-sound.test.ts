import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAdvance, simAgent, simCaller, simSystem } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const minute = 60_000;

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function waitingHarness(world: World, key: string): Promise<string> {
  const options = { key, repository: `unfoldingWord/${key}` };
  const { harness, admin } = await createSimHarness(world, software, options);
  const caller = simCaller(world, admin);
  const { itemId } = value(
    await world.kernel.items.enqueue(caller, {
      harnessId: harness.id,
      title: 'Wait for a review',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  const through = ['package', 'scope', 'plan', 'build'];
  await simAdvance(world, { harnessId: harness.id, itemId, worker: admin, through });
  return harness.id;
}

async function refusesOthers(world: World): Promise<void> {
  const { admin } = await createSimHarness(world, software);
  const agent = simAgent(admin, `${admin.personId ?? ''}/builder`, { interactive: false });
  const alarms = world.kernel.alarms;
  expect(reasonOf(await alarms.soundSilence(simCaller(world, admin), { limit: 1 }))).toBe(
    'not_permitted',
  );
  expect(reasonOf(await alarms.soundSilence(simCaller(world, agent), { limit: 1 }))).toBe(
    'not_permitted',
  );
  const system = simCaller(world, simSystem());
  const limits = [0, 201, 1.5];
  const reasons = [];
  for (const limit of limits) reasons.push(reasonOf(await alarms.soundSilence(system, { limit })));
  expect(reasons).toEqual(['malformed_command', 'malformed_command', 'malformed_command']);
  expect(reasonOf(await alarms.soundSilence(system, { limit: 200 }))).toBeNull();
}

async function takesTurns(world: World): Promise<void> {
  const first = await waitingHarness(world, 'first-quiet');
  const second = await waitingHarness(world, 'second-quiet');
  world.adapters.clock.advance(91 * minute);
  const system = simCaller(world, simSystem());
  const sounded: string[] = [];
  for (let turn = 0; turn < 2; turn += 1) {
    sounded.push(...value(await world.kernel.alarms.soundSilence(system, { limit: 1 })).sounded);
    world.adapters.clock.advance(minute);
  }
  expect([...sounded].sort()).toEqual([first, second].sort());
}

describe('OB-1 the silence alarm command', () => {
  it('OB-1 only the system sounds it, with a limit from 1 to 200', () => inWorld(refusesOthers));

  it('OB-1 a limit below the harness count takes the harnesses in turns, minute by minute', () =>
    inWorld(takesTurns));
});

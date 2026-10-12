import assert from 'node:assert/strict';
import { readAllEvents, software } from '@uw/harness';
import { createSimHarness } from '../fixtures.ts';
import {
  itemInScope,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  systemCaller,
  value,
  type RunWorld,
} from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const capMinor = 125_000;
const since = new Date('2026-10-01T00:00:00.000Z');

async function checkAt(scene: RunWorld, percent: number) {
  scene.world.adapters.modelEngine.setSpend({
    spentMinor: (capMinor * percent) / 100,
    currency: 'USD',
  });
  return value(
    await scene.world.kernel.breaker.check(systemCaller(scene), {
      capMinor,
      currency: 'USD',
      since,
    }),
  );
}

async function breakerNames(scene: RunWorld, harnessId: string): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, harnessId, null),
  );
  return events.filter((event) => event.name.startsWith('breaker_')).map((event) => event.name);
}

export const scenario = defineScenario({
  id: 'HE-5',
  title:
    'a cost spike holds hosted starts at 75 percent of the cap on every harness, hibernates the running hosted run at 90 percent, and a fall below 75 percent resumes it',
  run: async (world) => {
    const scene = await runWorld(world);
    const { harness: second } = await createSimHarness(world, software, { key: 'second' });
    assert.equal((await checkAt(scene, 10)).changed, false);
    const { runId } = value(await startOn(scene));
    const holding = await checkAt(scene, 80);
    assert.equal(holding.level, 'holding');
    const another = await itemInScope(scene, 'Start while the breaker holds');
    assert.equal(reasonOf(await startOn(scene, { itemId: another })), 'spend_held');
    const pausing = await checkAt(scene, 95);
    assert.deepEqual(pausing.hibernated, [runId]);
    assert.equal((await runOf(world, runId))?.hibernatedFor, 'breaker');
    const open = await checkAt(scene, 50);
    assert.deepEqual(open.resumed, [runId]);
    const names = [
      await breakerNames(scene, scene.harnessId),
      await breakerNames(scene, second.id),
    ];
    const expected = ['breaker_open', 'breaker_holding', 'breaker_pausing', 'breaker_open'];
    assert.deepEqual(names, [expected, expected]);
    return { state: { breaker: expected, run: (await runOf(world, runId))?.outcome } };
  },
});

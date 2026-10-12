import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { readSpend, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { runWorld, startOn, systemCaller, value, type RunWorld } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { simParkedAtShip, standardChange } from '../ship-fixtures.ts';
import { personOf } from '../wakes.ts';
import type { World } from '../world.ts';

const minute = 60_000;

type Phase = { readonly phase: string; readonly decisions: readonly string[] };

function park(scene: RunWorld, editor: Principal, title: string) {
  return simParkedAtShip(scene.world, {
    harnessId: scene.harnessId,
    editor,
    title,
    change: standardChange,
  });
}

async function advancedByDevice(scene: RunWorld): Promise<void> {
  const { world, owner } = scene;
  const person = simCaller(world, owner);
  const enqueued = await world.kernel.items.enqueue(person, {
    harnessId: scene.harnessId,
    title: 'Scope the copy',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const { itemId } = value(enqueued);
  const device = simCaller(
    world,
    simAgent(owner, `${personOf(owner)}/laptop`, { interactive: true }),
  );
  for (const caller of [person, device]) {
    value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
    value(
      await world.kernel.items.submit(caller, { itemId, to: null, evidence: {}, change: null }),
    );
  }
}

function decisionsSince(world: World, from: number, people: readonly string[]): readonly string[] {
  return world.adapters.notifier
    .decisions()
    .slice(from)
    .filter((decision) => people.includes(decision.personId))
    .map(
      (decision) => `${decision.personId === people[0] ? 'first' : 'second'}:${decision.decision}`,
    )
    .toSorted();
}

async function phases(scene: RunWorld, editor: Principal): Promise<readonly Phase[]> {
  const { world } = scene;
  const people = [personOf(scene.owner), personOf(scene.admin)];
  const steps: readonly [string, number, () => Promise<unknown>][] = [
    ['park A', 0, () => park(scene, editor, 'Gate A')],
    ['park B', 1, () => park(scene, editor, 'Gate B')],
    [
      'park C',
      10,
      async () => {
        world.adapters.hub.enter({
          harnessId: scene.harnessId,
          personId: personOf(scene.admin),
          screen: 'gates',
          itemId: null,
        });
        return park(scene, editor, 'Gate C');
      },
    ],
    ['stage advanced', 1, () => advancedByDevice(scene)],
    [
      'run failed',
      11,
      async () => {
        await readSpend(world);
        const { runId } = value(await startOn(scene));
        const failure = { step: 'work' as const, why: 'retries_exhausted' as const, detail: null };
        return world.kernel.runs.fail(systemCaller(scene), runId, failure);
      },
    ],
  ];
  const seen: Phase[] = [];
  for (const [phase, minutes, act] of steps) {
    world.adapters.clock.advance(minutes * minute);
    const from = world.adapters.notifier.decisions().length;
    await act();
    seen.push({ phase, decisions: decisionsSince(world, from, people) });
  }
  return seen;
}

export const scenario = defineScenario({
  id: 'NT-1',
  title:
    'a gate wake goes to every subscribed decider, an equal wake inside ten minutes is coalesced, a person watching the gates is not pushed, a weaker wake never spends the open window and a later run failure is sent',
  run: async (world) => {
    const scene = await runWorld(world);
    const editor = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    world.adapters.notifier.subscribe(personOf(scene.owner));
    world.adapters.notifier.subscribe(personOf(scene.admin));
    const seen = await phases(scene, editor);
    assert.deepEqual(seen, [
      { phase: 'park A', decisions: ['first:sent', 'second:sent'] },
      { phase: 'park B', decisions: ['first:coalesced', 'second:coalesced'] },
      { phase: 'park C', decisions: ['first:sent', 'second:suppressed'] },
      { phase: 'stage advanced', decisions: ['first:coalesced'] },
      { phase: 'run failed', decisions: ['first:sent'] },
    ]);
    return { state: { phases: seen } };
  },
});

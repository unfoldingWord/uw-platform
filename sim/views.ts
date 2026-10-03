import type { ItemState, Principal } from '@uw/contracts';
import type { Caller } from '@uw/harness';
import { simAgent, simCaller, simPerson } from './fixtures.ts';
import { beatOf, itemInScope, startOn, stepOn, value, runWorld, type RunWorld } from './runs.ts';
import type { World } from './world.ts';

export const minute = 60_000;

export type FlowWorld = RunWorld & {
  readonly editor: Principal;
  readonly laptop: Caller;
  readonly metered: string;
  readonly subscribed: string;
  readonly personHeld: string;
  readonly unheld: string;
};

async function enqueued(scene: RunWorld, title: string, priority = 1): Promise<string> {
  const outcome = await scene.world.kernel.items.enqueue(simCaller(scene.world, scene.admin), {
    harnessId: scene.harnessId,
    title,
    pageId: null,
    priority,
    due: null,
    delegationId: null,
  });
  return value(outcome).itemId;
}

export async function enqueuedMany(scene: RunWorld, count: number): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= count; n += 1) ids.push(await enqueued(scene, `Backlog item ${n}`, n % 3));
  return ids;
}

async function meteredRun(scene: RunWorld): Promise<void> {
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await stepOn(scene, beat, { runId, step: 'work' }));
}

async function subscribedRun(scene: RunWorld, laptop: Caller, itemId: string): Promise<void> {
  const { items } = scene.world.kernel;
  value(await items.claim(laptop, { itemId, delegationId: null }));
  value(
    await items.recordRunStep(laptop, {
      itemId,
      runId: scene.world.adapters.ids.next(),
      step: 'work',
      tokensIn: 900,
      tokensOut: 300,
      costBasis: 'subscription',
    }),
  );
}

export async function flowWorld(world: World): Promise<FlowWorld> {
  const scene = await runWorld(world);
  world.adapters.clock.advance(2 * minute);
  await meteredRun(scene);
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const laptop = simCaller(
    world,
    simAgent(editor, `${editor.personId ?? ''}/laptop`, { interactive: true }),
  );
  world.adapters.clock.advance(3 * minute);
  const subscribed = await itemInScope(scene, 'Write the run notes');
  await subscribedRun(scene, laptop, subscribed);
  world.adapters.clock.advance(4 * minute);
  const personHeld = await enqueued(scene, 'Review the copy');
  value(
    await world.kernel.items.claim(simCaller(world, scene.admin), {
      itemId: personHeld,
      delegationId: null,
    }),
  );
  const unheld = await enqueued(scene, 'Draw the icon');
  world.adapters.clock.advance(minute);
  return { ...scene, editor, laptop, metered: scene.itemId, subscribed, personHeld, unheld };
}

export function itemNow(world: World, itemId: string): Promise<ItemState | null> {
  return world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
}

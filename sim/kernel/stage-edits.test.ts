import type { Harness, HarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly harness: Harness; readonly ian: Caller };

async function withHarness(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    await work({ world, harness, ian: simCaller(world, admin) });
  } finally {
    await world.close();
  }
}

async function editsOf(scene: Scene): Promise<readonly HarnessEvent[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harness.id, null),
  );
  return events.filter((event) => event.name === 'stage_edited');
}

const extra = {
  key: 'extra',
  title: 'Extra',
  position: 90,
  bracket: 'iterate' as const,
  agentPickup: 'allowed' as const,
  exitGate: 'checks' as const,
  connector: 'none' as const,
  wipLimit: 3,
  instructionsPageId: null,
  validators: [],
  feeds: [],
};

async function createsExtra(scene: Scene): Promise<void> {
  const outcome = await scene.world.kernel.stages.createStage(scene.ian, {
    harnessId: scene.harness.id,
    stage: extra,
  });
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  const [edit] = await editsOf(scene);
  expect(edit).toMatchObject({
    itemId: null,
    actor: scene.ian.actor.identity,
    evidence: { stageId: outcome.value.id, key: 'extra', before: null },
  });
  expect(edit?.evidence['after']).toEqual({ ...extra, paused: false });
}

async function updatesReview(scene: Scene): Promise<void> {
  const outcome = await scene.world.kernel.stages.updateStage(scene.ian, {
    harnessId: scene.harness.id,
    stageKey: 'check',
    change: { exitGate: 'human_approval', wipLimit: 3, title: 'CI and review verdict' },
  });
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  expect((await editsOf(scene)).map((event) => event.evidence)).toEqual([
    {
      stageId: outcome.value.id,
      key: 'check',
      before: { exitGate: 'checks' },
      after: { exitGate: 'human_approval' },
    },
  ]);
}

async function reordersTwo(scene: Scene): Promise<void> {
  const order = software.stages.map((stage) => stage.key);
  const swapped = [order[0], order[2], order[1], ...order.slice(3)].filter(
    (key): key is string => key !== undefined,
  );
  const outcome = await scene.world.kernel.stages.reorderStages(scene.ian, {
    harnessId: scene.harness.id,
    order: swapped,
  });
  expect(outcome.status).toBe('accepted');
  expect((await editsOf(scene)).map((event) => event.evidence)).toEqual([
    expect.objectContaining({ key: 'scope', before: { position: 20 }, after: { position: 30 } }),
    expect.objectContaining({ key: 'plan', before: { position: 30 }, after: { position: 20 } }),
  ]);
}

async function refusedLeavesNone(scene: Scene): Promise<void> {
  await scene.world.kernel.stages.updateStage(scene.ian, {
    harnessId: scene.harness.id,
    stageKey: 'ship',
    change: { exitGate: 'checks' },
  });
  expect(await editsOf(scene)).toEqual([]);
}

describe('KN-18 every accepted stage edit is an event with only the columns it changed', () => {
  it('records a creation with no before and every column after', () => withHarness(createsExtra));

  it('records an update with only the changed columns', () => withHarness(updatesReview));

  it('records one event per stage a reorder moved', () => withHarness(reordersTwo));

  it('records no stage_edited for an edit Postgres refuses', () => withHarness(refusedLeavesNone));
});

import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  simAdvance,
  simAgent,
  simCaller,
  simPerson,
  simSeenHead,
} from '../fixtures.ts';
import { beatOf, runWorld, startOn, stepOn, systemCaller, value } from '../runs.ts';
import { loseAdmin, personOf, recipientIds, wakesFor } from '../wakes.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const failure = { step: 'work' as const, why: 'retries_exhausted' as const, detail: null };

type ParkScene = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Principal;
  readonly editor: Principal;
};

async function parkScene(world: World): Promise<ParkScene> {
  const { harness, admin } = await createSimHarness(world, software);
  value(
    await world.kernel.stages.updateStage(simCaller(world, admin), {
      harnessId: harness.id,
      stageKey: 'check',
      change: { exitGate: 'human_approval' },
    }),
  );
  const editor = await simPerson(world, 2, [{ role: 'editor', ...area }]);
  return { world, harnessId: harness.id, admin, editor };
}

async function parkedByLaptop(scene: ParkScene, title: string): Promise<string> {
  const { world, harnessId, admin, editor } = scene;
  const enqueued = await world.kernel.items.enqueue(simCaller(world, admin), {
    harnessId,
    title,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const { itemId } = value(enqueued);
  await simAdvance(world, { harnessId, itemId, worker: editor, through: ['package'] });
  const laptop = simAgent(editor, `${personOf(editor)}/laptop`, { interactive: true });
  const through = ['scope', 'plan', 'build', 'check'];
  const parked = await simAdvance(world, { harnessId, itemId, worker: laptop, through });
  expect(parked.gateStatus).toBe('parked');
  return itemId;
}

async function approve(scene: ParkScene, approver: Principal, itemId: string): Promise<void> {
  const decided = await scene.world.kernel.gates.decide(simCaller(scene.world, approver), {
    itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, itemId),
  });
  value(decided);
}

function advanceRecipients(world: World, itemId: string): readonly (readonly string[])[] {
  return wakesFor(world, itemId)
    .filter((wake) => wake.reason === 'stage_advanced')
    .map(recipientIds);
}

async function approvalWakes(
  scene: ParkScene,
  approver: Principal,
  itemId: string,
): Promise<readonly (readonly string[])[]> {
  const before = advanceRecipients(scene.world, itemId).length;
  await approve(scene, approver, itemId);
  return advanceRecipients(scene.world, itemId).slice(before);
}

async function advanceSkipsLostReader(world: World): Promise<void> {
  const scene = await parkScene(world);
  const areaAdmin = await simPerson(world, 5, [{ role: 'admin', ...area }]);
  const kept = await parkedByLaptop(scene, 'Check the copy');
  expect(await approvalWakes(scene, areaAdmin, kept)).toEqual([[personOf(scene.editor)]]);
  const lost = await parkedByLaptop(scene, 'Check the icon');
  await loseAdmin(world, scene.editor);
  expect(await approvalWakes(scene, areaAdmin, lost)).toEqual([]);
}

async function failureSkipsLostReader(world: World): Promise<void> {
  const scene = await runWorld(world);
  const { runId } = value(await startOn(scene));
  value(await stepOn(scene, await beatOf(scene), { runId, step: 'work' }));
  await loseAdmin(world, scene.owner);
  value(await world.kernel.runs.fail(systemCaller(scene), runId, failure));
  const wakes = wakesFor(world, scene.itemId).filter((wake) => wake.reason === 'run_failed');
  expect(wakes.map(recipientIds)).toEqual([[]]);
}

describe('wakes reach only people who can still read the harness', () => {
  it('a stage advance wakes nobody whose grant on the area was revoked', () =>
    inWorld(advanceSkipsLostReader));
  it('a run failure wakes nobody whose grant on the area was revoked', () =>
    inWorld(failureSkipsLostReader));
});

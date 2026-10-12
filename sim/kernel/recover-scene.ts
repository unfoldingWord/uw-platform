import type { Principal } from '@uw/contracts';
import type { Kernel } from '@uw/harness';
import { software } from '@uw/harness';
import { expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson, simSeenHead } from '../fixtures.ts';
import { kernelThatLosesTheExit } from '../lost-exit.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

export type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

export const sixteenMinutes = 16 * 60_000;
export const head = standardChange.head;

export function giveFacts(world: World, itemId: string, onHead: string, reviewId: number): void {
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', onHead, reviewId)];
  world.adapters.githubFacts.given(greenFacts(world, { itemId, head: onHead, reviews }));
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const parked = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: max,
      title: 'Show the board',
      change: standardChange,
    });
    giveFacts(world, parked.itemId, head, 9100000101);
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin, max });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

export function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

export async function decide(scene: Scene, kernel: Kernel, decision: 'approve' | 'take_over') {
  return kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision,
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
}

export function recoverAs(scene: Scene, who: Principal, kernel: Kernel = scene.world.kernel) {
  return kernel.gates.recoverConnectors(simCaller(scene.world, who), {
    harnessId: scene.harnessId,
  });
}

export async function lostApproval(scene: Scene, effectHappened: boolean): Promise<void> {
  const losing = kernelThatLosesTheExit(scene.world, { effectHappened });
  await expect(decide(scene, losing, 'approve')).rejects.toMatchObject({ name: 'ExitLost' });
}

export function logOf(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.itemId);
}

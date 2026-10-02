import type { Harness, ItemState, Stage } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';

export type HarnessScene = { readonly harness: Harness; readonly stages: readonly Stage[] };
export type ItemScene = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stage: Stage;
};

async function readableHarness(
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<Harness | null> {
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null || !allowed(caller.actor, 'read', harness, at)) return null;
  return harness;
}

export async function harnessScene(
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<KernelOutcome<HarnessScene>> {
  const harness = await readableHarness(tx, caller, harnessId, at);
  if (harness === null) return refused('harness_not_found', { harnessId });
  return accepted({ harness, stages: await tx.harnessStages.read.forHarness(harness.id) });
}

export async function itemScene(
  tx: StoreTransaction,
  caller: Caller,
  itemId: string,
  at: Date,
): Promise<KernelOutcome<ItemScene>> {
  const item = await tx.harnessItems.read.byId(itemId);
  const harness = item === null ? null : await readableHarness(tx, caller, item.harnessId, at);
  if (item === null || harness === null) return refused('item_not_found', { itemId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((candidate) => candidate.key === item.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stageKey: item.stageKey });
  return accepted({ item, harness, stage });
}

export function byPriorityThenId(
  a: Pick<ItemState, 'itemId' | 'priority'>,
  b: Pick<ItemState, 'itemId' | 'priority'>,
): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.itemId === b.itemId) return 0;
  return a.itemId < b.itemId ? -1 : 1;
}

export async function itemsInStage(
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly harnessId: string; readonly stageKey: string },
  at: Date,
): Promise<KernelOutcome<readonly ItemState[]>> {
  const scene = await harnessScene(tx, caller, input.harnessId, at);
  if (scene.status !== 'accepted') return scene;
  if (!scene.value.stages.some((stage) => stage.key === input.stageKey)) {
    return refused('stage_not_found', { stageKey: input.stageKey });
  }
  const items = await tx.harnessItems.read.forHarness(input.harnessId);
  return accepted(items.filter((item) => item.stageKey === input.stageKey).sort(byPriorityThenId));
}

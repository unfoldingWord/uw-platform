import type { ItemState, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { accepted, type KernelOutcome } from '../outcome.ts';
import type { ItemCost, StageEntry, StoreTransaction } from '../ports.ts';
import { harnessScene, type ScenePorts } from '../reads/scene.ts';
import { costOfItems } from './costs.ts';
import { VIEW_LIMIT, type FlowStage, type FlowView } from './types.ts';

type StageFacts = {
  readonly open: readonly ItemState[];
  readonly entries: readonly StageEntry[];
  readonly costs: readonly ItemCost[];
};

function oldestOf(ids: ReadonlySet<string>, entries: readonly StageEntry[]): Date | null {
  const times = entries.filter((entry) => ids.has(entry.itemId)).map((entry) => entry.at.getTime());
  return times.length === 0 ? null : new Date(Math.min(...times));
}

function stageRow(stage: Stage, held: number, facts: StageFacts): FlowStage {
  const here = facts.open.filter((item) => item.stageKey === stage.key);
  const ids = new Set(here.map((item) => item.itemId));
  return {
    stage,
    count: here.length,
    held,
    oldestEnteredAt: oldestOf(ids, facts.entries),
    cost: costOfItems(facts.costs.filter((cost) => ids.has(cost.itemId))),
  };
}

export function byPosition(stages: readonly Stage[]): readonly Stage[] {
  return [...stages].sort((a, b) => a.position - b.position);
}

export async function flowView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<KernelOutcome<FlowView>> {
  const scene = await harnessScene(ports, tx, caller, harnessId, at);
  if (scene.status !== 'accepted') return scene;
  const { harness, stages } = scene.value;
  const open = await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT);
  const ids = open.map((item) => item.itemId);
  const facts = {
    open,
    entries: await tx.harnessEvents.read.enteredStage(harness.id, ids),
    costs: await tx.harnessRuns.read.costsByItem(ids),
  };
  const rows: FlowStage[] = [];
  for (const stage of byPosition(stages)) {
    const held = await tx.harnessItems.read.heldInStage(harness.id, stage.key, at);
    rows.push(stageRow(stage, held, facts));
  }
  return accepted({ harness, stages: rows, capped: open.length === VIEW_LIMIT });
}

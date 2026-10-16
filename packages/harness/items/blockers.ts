import type { ItemState, Stage } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { refused, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';

type Mark = 'visiting' | 'done';

function shipStageOf(stages: readonly Stage[]): Stage | null {
  return stages
    .filter((stage) => stage.connector !== 'none')
    .reduce<Stage | null>(
      (lowest, stage) => (lowest === null || stage.position < lowest.position ? stage : lowest),
      null,
    );
}

export function passedShip(item: ItemState, stages: readonly Stage[]): boolean {
  if (item.gateStatus === 'done') return true;
  const ship = shipStageOf(stages);
  const at = stages.find((stage) => stage.key === item.stageKey);
  return ship !== null && at !== undefined && at.position > ship.position;
}

export function openBlockers(
  item: ItemState,
  items: readonly ItemState[],
  stages: readonly Stage[],
): readonly string[] {
  if (item.blockedBy.length === 0) return [];
  const byId = new Map(items.map((entry) => [entry.itemId, entry]));
  return item.blockedBy.filter((blockerId) => {
    const blocker = byId.get(blockerId);
    return blocker === undefined || !passedShip(blocker, stages);
  });
}

function cycleFrom(
  start: number,
  edges: ReadonlyMap<number, readonly number[]>,
  marks: Map<number, Mark>,
  path: number[],
): readonly number[] {
  marks.set(start, 'visiting');
  path.push(start);
  for (const next of edges.get(start) ?? []) {
    const mark = marks.get(next);
    if (mark === 'visiting') return path.slice(path.indexOf(next));
    const found = mark === undefined ? cycleFrom(next, edges, marks, path) : [];
    if (found.length > 0) return found;
  }
  path.pop();
  marks.set(start, 'done');
  return [];
}

export function blockerCycle(edges: ReadonlyMap<number, readonly number[]>): readonly number[] {
  const marks = new Map<number, Mark>();
  for (const start of [...edges.keys()].sort((a, b) => a - b)) {
    const found = marks.has(start) ? [] : cycleFrom(start, edges, marks, []);
    if (found.length > 0) return [...found].sort((a, b) => a - b);
  }
  return [];
}

export async function blockedRefusal(
  tx: StoreTransaction,
  caller: Caller,
  item: ItemState,
): Promise<Refused | null> {
  if (!isAgent(caller.actor) || item.blockedBy.length === 0) return null;
  const blockers = await tx.harnessItems.read.byIds(item.blockedBy);
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const open = openBlockers(item, blockers, stages);
  return open.length === 0 ? null : refused('not_permitted', { why: 'blocked', blockers: open });
}

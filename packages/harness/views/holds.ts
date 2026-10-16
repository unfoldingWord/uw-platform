import type { Harness, ItemState } from '@uw/contracts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { uncountedItems } from './bots.ts';
import { heldTooLong, holderOf, reviewingIds, type Holder } from './holder.ts';
import { VIEW_LIMIT } from './types.ts';

export type HeldRow = {
  readonly harness: Harness;
  readonly item: ItemState;
  readonly holder: Holder;
};
export type Holds = {
  readonly person: readonly HeldRow[];
  readonly agent: readonly HeldRow[];
  readonly uncounted: { readonly person: number; readonly agent: number };
  readonly capped: boolean;
};
type HoldPorts = Pick<Ports, 'githubFacts'>;
type Tally = { person: HeldRow[]; agent: HeldRow[]; uncounted: { person: number; agent: number } };

function emptyTally(): Tally {
  return { person: [], agent: [], uncounted: { person: 0, agent: 0 } };
}

function countOut(tally: Tally, over: 'person' | 'agent'): void {
  if (over === 'person') tally.uncounted.person += 1;
  else tally.uncounted.agent += 1;
}

async function heldIn(
  ports: HoldPorts,
  tx: StoreTransaction,
  harness: Harness,
  at: Date,
): Promise<Holds> {
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stageOf = new Map(stages.map((stage) => [stage.key, stage]));
  const open = await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT);
  const reviewing = await reviewingIds(tx, open);
  const left = await uncountedItems(ports.githubFacts, [{ harness, items: open }]);
  const tally = emptyTally();
  for (const item of open) {
    const holder = holderOf(item, stageOf.get(item.stageKey), reviewing.has(item.itemId));
    const over = heldTooLong(holder, at);
    if (holder === null || over === null) continue;
    if (left.has(item.itemId)) countOut(tally, over);
    else (over === 'person' ? tally.person : tally.agent).push({ harness, item, holder });
  }
  return { ...tally, capped: open.length === VIEW_LIMIT };
}

export async function holdsOf(
  ports: HoldPorts,
  tx: StoreTransaction,
  at: Date,
  within: ReadonlySet<string> | null = null,
): Promise<Holds> {
  const total = emptyTally();
  let capped = false;
  for (const harness of await tx.harnesses.read.list()) {
    if (within !== null && !within.has(harness.id)) continue;
    const held = await heldIn(ports, tx, harness, at);
    total.person.push(...held.person);
    total.agent.push(...held.agent);
    total.uncounted.person += held.uncounted.person;
    total.uncounted.agent += held.uncounted.agent;
    capped = capped || held.capped;
  }
  return { ...total, capped };
}

import type { Harness, ItemState } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StageCursor, StoreTransaction } from '../ports.ts';
import { byPriorityThenId } from '../reads/scene.ts';
import { agentRefusal } from '../stages/rules.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from './record.ts';

type ReorderPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ReorderInput = { readonly itemId: string; readonly beforeItemId: string | null };

type Placement = { readonly item: ItemState; readonly priority: number };

const spacing = 1000;
const pageSize = 200;
const lowestPriority = -(2 ** 31);
const highestPriority = 2 ** 31 - 1;

function placedOrder(
  order: readonly ItemState[],
  moved: ItemState,
  beforeItemId: string | null,
): readonly ItemState[] {
  const rest = order.filter((item) => item.itemId !== moved.itemId);
  const at = beforeItemId === null ? rest.length : rest.findIndex((i) => i.itemId === beforeItemId);
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

function between(above: ItemState | undefined, below: ItemState | undefined): number | null {
  if (above === undefined) return below === undefined ? null : below.priority + spacing;
  if (below === undefined) return above.priority - spacing;
  const gap = above.priority - below.priority;
  return gap >= 2 ? below.priority + Math.floor(gap / 2) : null;
}

function gapPriority(placed: readonly ItemState[], index: number): number | null {
  const priority = between(placed[index - 1], placed[index + 1]);
  if (priority === null) return null;
  return priority >= lowestPriority && priority <= highestPriority ? priority : null;
}

function placements(
  order: readonly ItemState[],
  placed: readonly ItemState[],
  moved: ItemState,
): readonly Placement[] {
  if (placed.every((item, index) => item.itemId === order.at(index)?.itemId)) return [];
  const priority = gapPriority(placed, placed.indexOf(moved));
  if (priority !== null) return [{ item: moved, priority }];
  return placed
    .map((item, index) => ({ item, priority: (placed.length - index) * spacing }))
    .filter((placement) => placement.item.priority !== placement.priority);
}

async function openPeers(
  tx: StoreTransaction,
  harnessId: string,
  stageKey: string,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let after: StageCursor | null = null; ;) {
    const page = await tx.harnessItems.read.openInStage(harnessId, stageKey, {
      after,
      limit: pageSize,
    });
    ids.push(...page.map((item) => item.itemId));
    const last = page.at(-1);
    if (page.length < pageSize || last === undefined) return ids.sort();
    after = { priority: last.priority, itemId: last.itemId };
  }
}

function openAt(row: ItemState, stageKey: string): boolean {
  return row.stageKey === stageKey && row.gateStatus !== 'done';
}

async function lockStage(
  tx: StoreTransaction,
  harnessId: string,
  stageKey: string,
): Promise<readonly ItemState[]> {
  const locked = new Map<string, ItemState>();
  for (let peers = await openPeers(tx, harnessId, stageKey); ;) {
    const unlocked = peers.filter((itemId) => !locked.has(itemId));
    if (unlocked.length === 0) break;
    for (const itemId of unlocked) {
      const row = await tx.harnessItems.read.lock(itemId);
      if (row !== null) locked.set(itemId, row);
    }
    peers = await openPeers(tx, harnessId, stageKey);
  }
  return [...locked.values()].filter((row) => openAt(row, stageKey)).sort(byPriorityThenId);
}

async function writeRefusal(
  ports: ReorderPorts,
  tx: StoreTransaction,
  caller: Caller,
  scene: { readonly harness: Harness; readonly at: Date },
): Promise<Refused | null> {
  const personId = caller.actor.personId;
  const denied = refused('not_permitted', { harnessId: scene.harness.id });
  if (personId === null) return denied;
  const grants = await ports.grants.lockAndReread(tx, personId, scene.at);
  const fresh = { ...caller.actor, grants: [...grants] };
  return allowed(fresh, 'write', scene.harness, scene.at) ? null : denied;
}

function placementRefusal(order: readonly ItemState[], input: ReorderInput): Refused | ItemState {
  const moved = order.find((item) => item.itemId === input.itemId);
  if (moved === undefined) return refused('stale_version', { itemId: input.itemId, why: 'moved' });
  if (input.beforeItemId === input.itemId) {
    return refused('malformed_command', { why: 'before_is_the_item' });
  }
  const known = input.beforeItemId === null || order.some((i) => i.itemId === input.beforeItemId);
  return known ? moved : refused('malformed_command', { why: 'before_not_in_stage' });
}

async function recordChanges(
  tx: StoreTransaction,
  context: RecordContext,
  input: ReorderInput,
  changes: readonly Placement[],
): Promise<ReadonlyMap<string, ItemState>> {
  const updated = new Map<string, ItemState>();
  for (const { item, priority } of changes) {
    const before = item.itemId === input.itemId ? input.beforeItemId : null;
    const recorded = await recordItemEvents(tx, context, item.itemId, [
      draft('item_reordered', { priority, before }),
    ]);
    updated.set(item.itemId, recorded.item);
  }
  return updated;
}

async function reorderIn(
  ports: ReorderPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: ReorderInput,
): Promise<KernelOutcome<readonly ItemState[]>> {
  const at = ports.clock.now();
  const pre = await tx.harnessItems.read.byId(input.itemId);
  const harness = pre === null ? null : await tx.harnesses.read.byId(pre.harnessId);
  if (pre === null || harness === null || !allowed(caller.actor, 'read', harness, at)) {
    return refused('item_not_found', { itemId: input.itemId });
  }
  if (!allowed(caller.actor, 'write', harness, at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.key === pre.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stage: pre.stageKey });
  await tx.lock(lockKeys.stageClaims(stage.id));
  const order = await lockStage(tx, harness.id, stage.key);
  const denied = await writeRefusal(ports, tx, caller, { harness, at });
  if (denied !== null) return denied;
  const moved = placementRefusal(order, input);
  if ('status' in moved) return moved;
  const placed = placedOrder(order, moved, input.beforeItemId);
  const changes = placements(order, placed, moved);
  const updated = await recordChanges(tx, recordContext(ports, caller, at), input, changes);
  return accepted(placed.map((item) => updated.get(item.itemId) ?? item));
}

export function reorder(
  ports: ReorderPorts,
  caller: Caller,
  input: ReorderInput,
): Promise<KernelOutcome<readonly ItemState[]>> {
  const agent = agentRefusal(caller);
  if (agent !== null) return Promise.resolve(agent);
  return ports.store.transaction((tx) => reorderIn(ports, tx, caller, input));
}

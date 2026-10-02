import type { ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { adminRefusal } from '../stages/rules.ts';
import { notReplayed, replay } from './fold.ts';
import { readAllEvents, RecordError } from './record.ts';

type RepairPorts = Pick<Ports, 'clock' | 'grants' | 'store'>;

export type Rebuilt = { readonly item: ItemState; readonly repaired: readonly string[] };

export type RepairCommands = {
  rebuildItem(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<Rebuilt>>;
};

function differing(row: ItemState, replayed: ItemState): string[] {
  return Object.keys(replayed).filter(
    (field) =>
      !notReplayed.some((kept) => kept === field) &&
      JSON.stringify(Reflect.get(row, field)) !== JSON.stringify(Reflect.get(replayed, field)),
  );
}

async function rebuildItem(
  ports: RepairPorts,
  caller: Caller,
  itemId: string,
): Promise<KernelOutcome<Rebuilt>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const row = await tx.harnessItems.read.lock(itemId);
    if (row === null) return refused('item_not_found', { itemId });
    const harness = await tx.harnesses.read.byId(row.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: row.harnessId });
    const denied = await adminRefusal(ports, tx, caller, harness, at);
    if (denied !== null) return denied;
    const replayed = replay(await readAllEvents(tx, row.harnessId, itemId));
    if (replayed === null) throw new RecordError('the item has no events to rebuild from', itemId);
    const repaired = differing(row, replayed);
    const rebuilt: ItemState = { ...replayed };
    for (const field of notReplayed) Object.assign(rebuilt, { [field]: Reflect.get(row, field) });
    if (repaired.length > 0) await tx.harnessItems.write.project(rebuilt);
    return accepted({ item: rebuilt, repaired });
  });
}

export function createRepairCommands(ports: RepairPorts): RepairCommands {
  return { rebuildItem: (caller, input) => rebuildItem(ports, caller, input.itemId) };
}

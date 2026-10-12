import { type HarnessEvent, type ItemState } from '@uw/contracts';
import { readAllEvents, replay, type Store, type StoreTransaction } from '@uw/harness';

export type WorldLog = {
  readonly events: readonly HarnessEvent[];
  readonly drift: readonly string[];
};

function driftFields(projected: ItemState, replayed: ItemState | null): string[] {
  if (replayed === null) return ['the item has no item_created event'];
  const fields = new Set([...Object.keys(projected), ...Object.keys(replayed)]);
  return [...fields].filter(
    (field) =>
      JSON.stringify(Reflect.get(projected, field)) !==
      JSON.stringify(Reflect.get(replayed, field)),
  );
}

function driftOf(projected: ItemState, events: readonly HarnessEvent[]): string | null {
  const own = events.filter((event) => event.itemId === projected.itemId);
  let fields: string[];
  try {
    fields = driftFields(projected, replay(own));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fields = [`the replay failing: ${reason}`];
  }
  return fields.length === 0
    ? null
    : `item ${projected.itemId}: the projection differs from the replay in ${fields.join(', ')}`;
}

async function readLog(tx: StoreTransaction): Promise<WorldLog> {
  const harnesses = [...(await tx.harnesses.read.list())].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const events: HarnessEvent[] = [];
  const drift: string[] = [];
  for (const harness of harnesses) {
    const own = await readAllEvents(tx, harness.id, null);
    events.push(...own);
    for (const item of await tx.harnessItems.read.forHarness(harness.id)) {
      const found = driftOf(item, own);
      if (found !== null) drift.push(found);
    }
  }
  return { events, drift };
}

export function readWorldLog(store: Store): Promise<WorldLog> {
  return store.transaction(readLog);
}

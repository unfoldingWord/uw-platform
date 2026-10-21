import {
  eventEvidenceSchemas,
  type Harness,
  type HarnessEvent,
  type ItemState,
} from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../ports.ts';
import type { ScenePorts } from '../reads/scene.ts';
import { readableHarnesses } from './readable.ts';
import { VIEW_LIMIT } from './types.ts';

const DELEGATED_MERGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type DelegatedMergeRow = {
  readonly harness: Harness;
  readonly itemId: string;
  readonly title: string;
  readonly email: string;
  readonly expiresAt: Date;
  readonly at: Date;
};

export type DelegatedMergeList = {
  readonly rows: readonly DelegatedMergeRow[];
  readonly capped: boolean;
};

const none: DelegatedMergeList = { rows: [], capped: false };

function rowOf(
  event: HarnessEvent,
  harnesses: ReadonlyMap<string, Harness>,
  items: ReadonlyMap<string, ItemState>,
): DelegatedMergeRow | null {
  const harness = harnesses.get(event.harnessId);
  const item = event.itemId === null ? undefined : items.get(event.itemId);
  const evidence = eventEvidenceSchemas.delegated_merge.safeParse(event.evidence);
  if (harness === undefined || item === undefined || !evidence.success) return null;
  const { email, expiresAt } = evidence.data;
  return {
    harness,
    itemId: item.itemId,
    title: item.title,
    email,
    expiresAt: new Date(expiresAt),
    at: new Date(event.at),
  };
}

async function administered(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<ReadonlyMap<string, Harness>> {
  if (isAgent(caller.actor) || caller.actor.personId === null) return new Map();
  const readable = await readableHarnesses(ports, tx, caller, at);
  const admin = readable.filter((harness) => allowed(caller.actor, 'admin', harness, at));
  return new Map(admin.map((harness) => [harness.id, harness]));
}

export async function delegatedMerges(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<DelegatedMergeList> {
  const harnesses = await administered(ports, tx, caller, at);
  if (harnesses.size === 0) return none;
  const since = new Date(at.getTime() - DELEGATED_MERGE_WINDOW_MS);
  const events = await tx.harnessEvents.read.recent({
    since,
    names: ['delegated_merge'],
    agentsOnly: false,
    limit: VIEW_LIMIT,
    harnessIds: [...harnesses.keys()],
  });
  const itemIds = events.flatMap((event) => (event.itemId === null ? [] : [event.itemId]));
  const items = new Map(
    (await tx.harnessItems.read.byIds(itemIds)).map((item) => [item.itemId, item]),
  );
  const rows = events
    .flatMap((event) => {
      const row = rowOf(event, harnesses, items);
      return row === null ? [] : [row];
    })
    .toSorted((left, right) => right.at.getTime() - left.at.getTime());
  return { rows, capped: events.length === VIEW_LIMIT };
}

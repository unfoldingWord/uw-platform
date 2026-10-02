import {
  newEventSchema,
  type EventEvidence,
  type EventName,
  type EvidenceName,
  type HarnessEvent,
  type Identity,
  type ItemState,
  type NewHarnessEvent,
} from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { Ids, Ports, StoreTransaction } from '../ports.ts';

type ItemTransaction = Pick<StoreTransaction, 'harnessItems' | 'harnessEvents'>;
type EventTransaction = Pick<StoreTransaction, 'harnessEvents'>;
import { foldItem } from './fold.ts';

export type RecordContext = {
  readonly actor: Identity;
  readonly at: Date;
  readonly traceId: string;
  readonly ids: Ids;
};

export type EventDraft = { readonly name: EventName; readonly evidence: HarnessEvent['evidence'] };

export type NewItem = {
  readonly itemId: string;
  readonly harnessId: string;
  readonly stageKey: string;
  readonly title: string;
  readonly pageId: string | null;
  readonly priority: number;
  readonly due: string | null;
};

export type Recorded = {
  readonly events: readonly HarnessEvent[];
  readonly item: ItemState;
};

export class RecordError extends Error {
  readonly itemId: string;

  constructor(message: string, itemId: string) {
    super(message);
    this.name = 'RecordError';
    this.itemId = itemId;
  }
}

export function draft<N extends EvidenceName>(name: N, evidence: EventEvidence[N]): EventDraft {
  return { name, evidence };
}

export function recordContext(ports: Pick<Ports, 'ids'>, caller: Caller, at: Date): RecordContext {
  return { actor: caller.actor.identity, at, traceId: caller.traceId, ids: ports.ids };
}

function stamp(
  context: RecordContext,
  harnessId: string,
  itemId: string | null,
  event: EventDraft,
): NewHarnessEvent {
  return newEventSchema.parse({
    eventId: context.ids.next(),
    harnessId,
    itemId,
    name: event.name,
    at: context.at.toISOString(),
    actor: context.actor,
    evidence: event.evidence,
    traceId: context.traceId,
  });
}

export async function recordHarnessEvents(
  tx: EventTransaction,
  context: RecordContext,
  harnessId: string,
  drafts: readonly EventDraft[],
): Promise<readonly HarnessEvent[]> {
  const stamped = drafts.map((entry) => stamp(context, harnessId, null, entry));
  return tx.harnessEvents.write.append(stamped);
}

export async function recordItemEvents(
  tx: ItemTransaction,
  context: RecordContext,
  itemId: string,
  drafts: readonly EventDraft[],
): Promise<Recorded> {
  const locked = await tx.harnessItems.read.lock(itemId);
  if (locked === null) throw new RecordError('the item to record against does not exist', itemId);
  const stamped = drafts.map((entry) => stamp(context, locked.harnessId, itemId, entry));
  const next = stamped.reduce<ItemState>(foldItem, locked);
  await tx.harnessItems.write.project(next);
  const events = await tx.harnessEvents.write.append(stamped);
  return { events, item: next };
}

export async function createItem(
  tx: ItemTransaction,
  context: RecordContext,
  initial: NewItem,
): Promise<Recorded> {
  const event = stamp(
    context,
    initial.harnessId,
    initial.itemId,
    draft('item_created', {
      stage: initial.stageKey,
      title: initial.title,
      pageId: initial.pageId,
      priority: initial.priority,
      due: initial.due,
    }),
  );
  const item = foldItem(null, event);
  await tx.harnessItems.write.insert(item, context.at);
  const events = await tx.harnessEvents.write.append([event]);
  return { events, item };
}

export async function readAllEvents(
  tx: EventTransaction,
  harnessId: string,
  itemId: string | null,
): Promise<readonly HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  let after = 0;
  while (true) {
    const page = await tx.harnessEvents.read.page({ harnessId, itemId, after, limit: 100 });
    events.push(...page.events);
    if (page.next === null) return events;
    after = page.next;
  }
}

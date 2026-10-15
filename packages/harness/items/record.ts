import {
  newEventSchema,
  type EventEvidence,
  type EventName,
  type EvidenceName,
  type HarnessEvent,
  type Identity,
  type IssueRef,
  type ItemState,
  type NewHarnessEvent,
} from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { sameRepository } from '../github/identifiers.ts';
import type { Ids, Ports, StoreTransaction } from '../ports.ts';

import { foldItem } from './fold.ts';

type ItemTransaction = Pick<StoreTransaction, 'harnessItems' | 'harnessEvents'>;
type EventTransaction = Pick<StoreTransaction, 'harnessEvents'>;
type CreateTransaction = Pick<StoreTransaction, 'harnesses' | 'harnessItems' | 'harnessEvents'>;

export type RecordContext = {
  readonly actor: Identity;
  readonly at: Date;
  readonly traceId: string;
  readonly requestId: string | null;
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
  readonly issue: IssueRef | null;
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
  return {
    actor: caller.actor.identity,
    at,
    traceId: caller.traceId,
    requestId: caller.requestId ?? null,
    ids: ports.ids,
  };
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
    requestId: context.requestId,
  });
}

export async function recordHarnessEvents(
  tx: EventTransaction,
  context: RecordContext,
  harnessId: string,
  drafts: readonly EventDraft[],
): Promise<readonly HarnessEvent[]> {
  if (drafts.length === 0) return [];
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
  if (drafts.length === 0) return { events: [], item: locked };
  const stamped = drafts.map((entry) => stamp(context, locked.harnessId, itemId, entry));
  const next = stamped.reduce<ItemState>(foldItem, locked);
  await tx.harnessItems.write.project(next);
  const events = await tx.harnessEvents.write.append(stamped);
  return { events, item: next };
}

async function assertIssueInHarnessRepository(
  tx: CreateTransaction,
  initial: NewItem,
): Promise<void> {
  if (initial.issue === null) return;
  const harness = await tx.harnesses.read.byId(initial.harnessId);
  if (!sameRepository(initial.issue.repo, harness?.repository ?? null)) {
    throw new RecordError('the issue is not in the harness repository', initial.itemId);
  }
}

export async function createItem(
  tx: CreateTransaction,
  context: RecordContext,
  initial: NewItem,
): Promise<Recorded> {
  await assertIssueInHarnessRepository(tx, initial);
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
      issue: initial.issue,
      pullRequest: null,
      expectedHead: null,
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

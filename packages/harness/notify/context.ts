import type { Harness, HarnessEvent, Identity, ItemState } from '@uw/contracts';
import { replay } from '../items/fold.ts';
import { readAllEvents } from '../items/record.ts';
import type { Delegation, RunRow, StoreTransaction } from '../ports.ts';
import { freeTopic, itemRefOf, topicFor } from './topic.ts';
import type { Trigger } from './triggers.ts';

export type ItemContext = {
  readonly item: ItemState;
  readonly prior: ItemState | null;
  readonly parkedBy: Identity | null;
  readonly topic: string;
};

export type WakeContext = {
  readonly harnesses: ReadonlyMap<string, Harness>;
  readonly items: ReadonlyMap<string, ItemContext>;
  readonly runs: ReadonlyMap<string, RunRow>;
  readonly delegations: ReadonlyMap<string, Delegation>;
};

function unique(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function evidenceId(event: HarnessEvent, key: 'runId' | 'delegationId'): string | null {
  const found = new Map(Object.entries(event.evidence)).get(key);
  return typeof found === 'string' ? found : null;
}

function firstPosition(events: readonly HarnessEvent[], itemId: string): number {
  return Math.min(...events.filter((event) => event.itemId === itemId).map((e) => e.position));
}

function lastParker(events: readonly HarnessEvent[]): Identity | null {
  const parked = events.filter(
    (event) => event.name === 'submitted_to_gate' && event.evidence['result'] === 'parked',
  );
  return parked.at(-1)?.actor ?? null;
}

async function topicOf(tx: StoreTransaction, item: ItemState, harness: Harness): Promise<string> {
  if (item.zulipTopic !== null) return item.zulipTopic;
  return (await freeTopic(tx, item, harness.key)) ?? topicFor(harness.key, itemRefOf(item));
}

async function itemContext(
  tx: StoreTransaction,
  item: ItemState,
  harness: Harness,
  batch: readonly HarnessEvent[],
): Promise<ItemContext> {
  const before = firstPosition(batch, item.itemId);
  const all = await readAllEvents(tx, item.harnessId, item.itemId);
  const earlier = all.filter((event) => event.position < before);
  const topic = await topicOf(tx, item, harness);
  return { item, prior: replay(earlier), parkedBy: lastParker(earlier), topic };
}

async function readEach<T>(
  ids: readonly string[],
  read: (id: string) => Promise<T | null>,
): Promise<ReadonlyMap<string, T>> {
  const found = new Map<string, T>();
  for (const id of ids) {
    const row = await read(id);
    if (row !== null) found.set(id, row);
  }
  return found;
}

async function itemsOf(
  tx: StoreTransaction,
  triggers: readonly Trigger[],
  harnesses: ReadonlyMap<string, Harness>,
  batch: readonly HarnessEvent[],
): Promise<ReadonlyMap<string, ItemContext>> {
  const items = await readEach(unique(triggers.map(({ event }) => event.itemId)), (id) =>
    tx.harnessItems.read.byId(id),
  );
  const contexts = new Map<string, ItemContext>();
  for (const [itemId, item] of items) {
    const harness = harnesses.get(item.harnessId);
    if (harness !== undefined) contexts.set(itemId, await itemContext(tx, item, harness, batch));
  }
  return contexts;
}

export async function readWakeContext(
  tx: StoreTransaction,
  triggers: readonly Trigger[],
  batch: readonly HarnessEvent[],
): Promise<WakeContext> {
  const events = triggers.map(({ event }) => event);
  const harnesses = await readEach(unique(events.map((event) => event.harnessId)), (id) =>
    tx.harnesses.read.byId(id),
  );
  const items = await itemsOf(tx, triggers, harnesses, batch);
  const runs = await readEach(unique(events.map((event) => evidenceId(event, 'runId'))), (id) =>
    tx.harnessRuns.read.byId(id),
  );
  const delegationIds = unique([
    ...events.map((event) => evidenceId(event, 'delegationId')),
    ...[...runs.values()].map((run) => run.delegationId),
    ...[...items.values()].map(({ prior }) => prior?.delegationId ?? null),
  ]);
  const delegations = await readEach(delegationIds, (id) => tx.delegations.read.byId(id));
  return { harnesses, items, runs, delegations };
}

export function triggerRun(context: WakeContext, event: HarnessEvent): RunRow | null {
  const runId = evidenceId(event, 'runId');
  return runId === null ? null : (context.runs.get(runId) ?? null);
}

export function triggerDelegation(context: WakeContext, event: HarnessEvent): Delegation | null {
  const delegationId = evidenceId(event, 'delegationId');
  return delegationId === null ? null : (context.delegations.get(delegationId) ?? null);
}

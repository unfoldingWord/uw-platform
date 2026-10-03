import type { Harness, IssueRef, ItemState } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal } from '../delegations/acting.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { createItem, recordContext, type RecordContext, type Recorded } from './record.ts';

type EnqueuePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type EnqueueInput = {
  readonly harnessId: string;
  readonly title: string;
  readonly pageId: string | null;
  readonly priority: number | null;
  readonly due: string | null;
  readonly delegationId: string | null;
};

export type EnqueueDraft = {
  readonly title: string;
  readonly pageId: string | null;
  readonly priority: number | null;
  readonly due: string | null;
  readonly issue: IssueRef | null;
};

export async function enqueueIn(
  tx: StoreTransaction,
  context: RecordContext,
  harness: Harness,
  input: EnqueueDraft,
): Promise<KernelOutcome<Recorded>> {
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const first = stages.reduce<(typeof stages)[number] | null>(
    (lowest, stage) => (lowest === null || stage.position < lowest.position ? stage : lowest),
    null,
  );
  if (first === null) return refused('stage_not_found', { harnessId: harness.id });
  const priority = input.priority ?? (await bottomOf(tx, harness.id, first.key));
  return accepted(
    await createItem(tx, context, {
      itemId: context.ids.next(),
      harnessId: harness.id,
      stageKey: first.key,
      ...input,
      priority,
    }),
  );
}

const laneSpacing = 1000;
const lowestPriority = -(2 ** 31);

async function bottomOf(tx: StoreTransaction, harnessId: string, stageKey: string) {
  const lowest = await tx.harnessItems.read.lowestOpenPriority(harnessId, stageKey);
  return lowest === null ? 0 : Math.max(lowest - laneSpacing, lowestPriority);
}

const oneItemPerRequest = 'harness_events_one_item_per_request';

async function alreadyCreated(
  ports: EnqueuePorts,
  caller: Caller,
  error: unknown,
): Promise<KernelOutcome<ItemState>> {
  const requestId = caller.requestId ?? null;
  if (storeRefusalOf(error)?.constraint !== oneItemPerRequest || requestId === null) throw error;
  const item = await ports.store.transaction(async (tx) => {
    const itemId = await tx.harnessEvents.read.createdFor(caller.actor.identity, requestId);
    return itemId === null ? null : tx.harnessItems.read.byId(itemId);
  });
  if (item === null) throw error;
  return accepted(item);
}

export async function enqueue(
  ports: EnqueuePorts,
  caller: Caller,
  input: EnqueueInput,
): Promise<KernelOutcome<ItemState>> {
  return enqueueOnce(ports, caller, input).catch((error: unknown) =>
    alreadyCreated(ports, caller, error),
  );
}

function enqueueOnce(
  ports: EnqueuePorts,
  caller: Caller,
  input: EnqueueInput,
): Promise<KernelOutcome<ItemState>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const context = recordContext(ports, caller, at);
    const { delegationId } = input;
    const actor = await actingPrincipal(ports, tx, { caller, harness, delegationId, context });
    if (isRefusal(actor)) return actor;
    if (!allowed(actor, 'write', harness, at)) {
      return refused('not_permitted', { harnessId: harness.id });
    }
    const recorded = await enqueueIn(tx, context, harness, {
      title: input.title,
      pageId: input.pageId,
      priority: input.priority,
      due: input.due,
      issue: null,
    });
    return recorded.status === 'accepted' ? accepted(recorded.value.item) : recorded;
  });
}

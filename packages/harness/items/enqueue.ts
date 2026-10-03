import type { Harness, IssueRef, ItemState } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal } from '../delegations/acting.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { createItem, recordContext, type RecordContext, type Recorded } from './record.ts';

type EnqueuePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type EnqueueInput = {
  readonly harnessId: string;
  readonly title: string;
  readonly pageId: string | null;
  readonly priority: number;
  readonly due: string | null;
  readonly delegationId: string | null;
};

export type EnqueueDraft = {
  readonly title: string;
  readonly pageId: string | null;
  readonly priority: number;
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
  return accepted(
    await createItem(tx, context, {
      itemId: context.ids.next(),
      harnessId: harness.id,
      stageKey: first.key,
      ...input,
    }),
  );
}

const oneItemPerRequest = 'harness_events_one_item_per_request';

function requestRefusal(error: unknown, caller: Caller): Refused {
  if (storeRefusalOf(error)?.constraint !== oneItemPerRequest) throw error;
  return refused('request_in_flight', { requestId: caller.requestId ?? null });
}

export async function enqueue(
  ports: EnqueuePorts,
  caller: Caller,
  input: EnqueueInput,
): Promise<KernelOutcome<ItemState>> {
  return enqueueOnce(ports, caller, input).catch((error: unknown) => requestRefusal(error, caller));
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

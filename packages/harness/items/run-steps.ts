import type { CostBasis, EventEvidence, ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { assertDelegationLive, recordLapse } from '../delegations/live.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { expireLapsedLease, LEASE_MS, LEASE_WARNING_MS, leaseLapsed } from './leases.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from './record.ts';
import { holdsClaim } from './release.ts';

type RunStep = EventEvidence['run_step_recorded']['step'];
type StepPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type LeaseOutcome = { readonly leaseExpiresAt: string; readonly leaseWarning: boolean };
export type RenewInput = { readonly itemId: string };
export type RunStepInput = {
  readonly itemId: string;
  readonly runId: string;
  readonly step: RunStep;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costBasis: CostBasis;
};
export type SweepInput = { readonly limit: number };
export type Swept = { readonly expired: readonly string[] };

async function holderRefusal(
  tx: StoreTransaction,
  caller: Caller,
  item: ItemState,
): Promise<Refused | null> {
  const { actor } = caller;
  const holds =
    actor.kind === 'agent' &&
    item.leaseExpiresAt !== null &&
    (await holdsClaim(tx, item, actor, { itemId: item.itemId, delegationId: item.delegationId }));
  return holds ? null : refused('not_holder', { itemId: item.itemId });
}

async function delegationRefusal(
  tx: StoreTransaction,
  ports: StepPorts,
  context: RecordContext,
  item: ItemState,
): Promise<Refused | null> {
  const { delegationId } = item;
  if (delegationId === null) return null;
  const liveness = await assertDelegationLive(tx, ports, delegationId, context.at);
  if (liveness.live) return null;
  if (liveness.delegation === null) return refused('delegation_not_found', { delegationId });
  if (liveness.why !== null) await recordLapse(tx, context, liveness.delegation, liveness.why);
  return refused('delegation_lapsed', { delegationId, why: liveness.why });
}

function stepDraft(input: RunStepInput | null, leaseExpiresAt: string) {
  if (input === null) return draft('lease_renewed', { leaseExpiresAt });
  return draft('run_step_recorded', {
    runId: input.runId,
    step: input.step,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costBasis: input.costBasis,
    leaseExpiresAt,
  });
}

type Renewal = {
  readonly caller: Caller;
  readonly itemId: string;
  readonly input: RunStepInput | null;
  readonly at: Date;
};

async function renewIn(
  ports: StepPorts,
  tx: StoreTransaction,
  { caller, itemId, input, at }: Renewal,
): Promise<KernelOutcome<LeaseOutcome>> {
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const context = recordContext(ports, caller, at);
  const notHolder = await holderRefusal(tx, caller, item);
  if (notHolder !== null) return notHolder;
  const lapsed = await delegationRefusal(tx, ports, context, item);
  if (lapsed !== null) return lapsed;
  if (leaseLapsed(item, at)) {
    await expireLapsedLease(tx, context, item);
    return refused('lease_expired', { itemId, leaseExpiresAt: item.leaseExpiresAt });
  }
  const remaining = new Date(item.leaseExpiresAt ?? at).getTime() - at.getTime();
  const leaseExpiresAt = new Date(at.getTime() + LEASE_MS).toISOString();
  await recordItemEvents(tx, context, itemId, [stepDraft(input, leaseExpiresAt)]);
  return accepted({ leaseExpiresAt, leaseWarning: remaining <= LEASE_WARNING_MS });
}

export function renewLease(
  ports: StepPorts,
  caller: Caller,
  input: RenewInput,
): Promise<KernelOutcome<LeaseOutcome>> {
  const at = ports.clock.now();
  return ports.store.transaction((tx) =>
    renewIn(ports, tx, { caller, itemId: input.itemId, input: null, at }),
  );
}

export function recordRunStep(
  ports: StepPorts,
  caller: Caller,
  input: RunStepInput,
): Promise<KernelOutcome<LeaseOutcome>> {
  const at = ports.clock.now();
  return ports.store.transaction((tx) =>
    renewIn(ports, tx, { caller, itemId: input.itemId, input, at }),
  );
}

async function expireOne(
  tx: StoreTransaction,
  context: RecordContext,
  itemId: string,
): Promise<boolean> {
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null || !leaseLapsed(item, context.at)) return false;
  await expireLapsedLease(tx, context, item);
  return true;
}

export async function expireLeases(
  ports: StepPorts,
  caller: Caller,
  input: SweepInput,
): Promise<KernelOutcome<Swept>> {
  const at = ports.clock.now();
  const context = recordContext(ports, caller, at);
  const lapsed = await ports.store.transaction((tx) =>
    tx.harnessItems.read.lapsedLeases(at, input.limit),
  );
  const expired: string[] = [];
  for (const itemId of lapsed) {
    if (await ports.store.transaction((tx) => expireOne(tx, context, itemId))) {
      expired.push(itemId);
    }
  }
  return accepted({ expired });
}

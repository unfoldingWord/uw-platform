import type { ItemState } from '@uw/contracts';
import { allowed, isAgent, isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal } from '../delegations/acting.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { recordStepIn } from '../runs/steps.ts';
import type { RunStepInput } from '../runs/types.ts';
import { expireLapsedLease, LEASE_MS, LEASE_WARNING_MS, leaseLapsed } from './leases.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from './record.ts';
import { pausedRefusal } from './paused.ts';
import { holdsClaim } from './release.ts';

type StepPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type LeaseOutcome = { readonly leaseExpiresAt: string; readonly leaseWarning: boolean };
export type StepOutcome = LeaseOutcome & { readonly prompts: readonly string[] };
export type RenewInput = { readonly itemId: string };
export type SweepInput = { readonly limit: number };
export type Swept = { readonly expired: readonly string[] };

async function holderRefusal(
  tx: StoreTransaction,
  caller: Caller,
  item: ItemState,
): Promise<Refused | null> {
  const { actor } = caller;
  const holds =
    isAgent(actor) &&
    item.leaseExpiresAt !== null &&
    (await holdsClaim(tx, item, actor, { itemId: item.itemId, delegationId: item.delegationId }));
  return holds ? null : refused('not_holder', { itemId: item.itemId });
}

export async function heldStanding(
  tx: StoreTransaction,
  ports: StepPorts,
  context: RecordContext,
  scene: { readonly caller: Caller; readonly item: ItemState },
): Promise<Refused | null> {
  const { caller, item } = scene;
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  const acting = await actingPrincipal(ports, tx, {
    caller,
    harness,
    delegationId: item.delegationId,
    context,
  });
  if (isRefusal(acting)) return acting;
  if (allowed(acting, 'write', harness, context.at)) return null;
  return refused('not_permitted', { harnessId: harness.id });
}

async function stepPaused(
  tx: StoreTransaction,
  caller: Caller,
  item: ItemState,
): Promise<Refused | null> {
  const harness = await tx.harnesses.read.byId(item.harnessId);
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (harness === null || stage === undefined) return null;
  return pausedRefusal(caller, harness, stage);
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
    costMinor: input.costMinor ?? null,
    computeMinor: input.computeMinor ?? null,
    model: input.model ?? null,
    resolvedProvider: input.resolvedProvider ?? null,
    toolsCalled: [...(input.toolsCalled ?? [])],
    writes: input.writes ?? 0,
  });
}

type Renewal = {
  readonly caller: Caller;
  readonly itemId: string;
  readonly input: RunStepInput | null;
  readonly at: Date;
};

const noStep = { drafts: [], prompts: [] } as const;

function stepIn(tx: StoreTransaction, context: RecordContext, scene: Renewal, item: ItemState) {
  const { caller, input } = scene;
  return input === null ? noStep : recordStepIn(tx, context, { caller, item, input });
}

async function renewIn(
  ports: StepPorts,
  tx: StoreTransaction,
  renewal: Renewal,
): Promise<KernelOutcome<StepOutcome>> {
  const { caller, itemId, input, at } = renewal;
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const context = recordContext(ports, caller, at);
  const notHolder = await holderRefusal(tx, caller, item);
  if (notHolder !== null) return notHolder;
  const halted = input === null ? null : await stepPaused(tx, caller, item);
  if (halted !== null) return halted;
  const standing = await heldStanding(tx, ports, context, { caller, item });
  if (standing !== null) return standing;
  if (leaseLapsed(item, at)) {
    await expireLapsedLease(tx, context, item);
    return refused('lease_expired', { itemId, leaseExpiresAt: item.leaseExpiresAt });
  }
  const step = await stepIn(tx, context, renewal, item);
  if ('status' in step) return step;
  const remaining = new Date(item.leaseExpiresAt ?? at).getTime() - at.getTime();
  const leaseExpiresAt = new Date(at.getTime() + LEASE_MS).toISOString();
  await recordItemEvents(tx, context, itemId, [...step.drafts, stepDraft(input, leaseExpiresAt)]);
  const leaseWarning = remaining <= LEASE_WARNING_MS;
  return accepted({ leaseExpiresAt, leaseWarning, prompts: step.prompts });
}

export async function renewLease(
  ports: StepPorts,
  caller: Caller,
  input: RenewInput,
): Promise<KernelOutcome<LeaseOutcome>> {
  const at = ports.clock.now();
  const renewed = await ports.store.transaction((tx) =>
    renewIn(ports, tx, { caller, itemId: input.itemId, input: null, at }),
  );
  if (renewed.status !== 'accepted') return renewed;
  const { leaseExpiresAt, leaseWarning } = renewed.value;
  return accepted({ leaseExpiresAt, leaseWarning });
}

export function recordRunStep(
  ports: StepPorts,
  caller: Caller,
  input: RunStepInput,
): Promise<KernelOutcome<StepOutcome>> {
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
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
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

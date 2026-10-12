import type { CapabilityWord, Harness, ItemState, Principal, RunOutcome } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { beatPrincipal } from '../delegations/beat.ts';
import { assertDelegationLive, markLapse, type Liveness } from '../delegations/live.ts';
import { lapseDrafts, leaseLapsed } from '../items/leases.ts';
import {
  draft,
  recordContext,
  recordHarnessEvents,
  recordItemEvents,
  type RecordContext,
} from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { pinnedPersonaOf } from './persona.ts';
import { ended, heldByRun } from './rows.ts';
import type { RunScene } from './types.ts';

type ScenePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

type HeldItem = {
  readonly item: ItemState;
  readonly seen: RunRow;
  readonly delegationId: string;
  readonly outcomes: readonly RunOutcome[];
};

export type Locked = {
  readonly item: ItemState;
  readonly run: RunRow;
  readonly delegationId: string;
};

type Lapsed = Extract<Liveness, { readonly live: false }>;

type Standing = Locked & {
  readonly principal: Principal;
  readonly harness: Harness;
  readonly capability: CapabilityWord;
};

const runningOnly: readonly RunOutcome[] = ['running'];

function outcomeRefusal(run: RunRow, outcomes: readonly RunOutcome[]): Refused | null {
  if (outcomes.includes(run.outcome)) return null;
  return refused('not_permitted', { why: `run_${run.outcome}` });
}

export async function heldItem(
  tx: StoreTransaction,
  runId: string,
  outcomes: readonly RunOutcome[] = runningOnly,
): Promise<HeldItem | Refused> {
  const missing = refused('run_not_found', { runId });
  const seen = await tx.harnessRuns.read.byId(runId);
  if (seen === null || seen.runShape !== 'workflow-run' || seen.delegationId === null) {
    return missing;
  }
  const early = outcomeRefusal(seen, outcomes);
  if (early !== null) return early;
  const item = await tx.harnessItems.read.lock(seen.itemId);
  if (item === null) return missing;
  return { item, seen, delegationId: seen.delegationId, outcomes };
}

async function lockRun(tx: StoreTransaction, held: HeldItem): Promise<Locked | Refused> {
  const run = await tx.harnessRuns.read.lock(held.seen.id);
  if (run === null) return refused('run_not_found', { runId: held.seen.id });
  return outcomeRefusal(run, held.outcomes) ?? { ...held, run };
}

export async function lockedRun(
  tx: StoreTransaction,
  runId: string,
  outcomes: readonly RunOutcome[],
): Promise<Locked | Refused> {
  const held = await heldItem(tx, runId, outcomes);
  return 'status' in held ? held : lockRun(tx, held);
}

async function stopForLapse(
  tx: StoreTransaction,
  context: RecordContext,
  held: HeldItem,
  { delegation, why }: Lapsed,
): Promise<Refused> {
  const lapse =
    delegation !== null && why !== null ? await markLapse(tx, context.at, delegation, why) : [];
  const locked = await lockRun(tx, held);
  if (!('status' in locked)) {
    await tx.harnessRuns.write.update(ended(locked.run, { outcome: 'stopped' }, context.at));
  }
  if (delegation !== null) await recordHarnessEvents(tx, context, delegation.harnessId, lapse);
  if ('status' in locked) return locked;
  const { item, run } = locked;
  const released = heldByRun(item, run) ? [draft('item_released', { holder: run.persona })] : [];
  await recordItemEvents(tx, context, item.itemId, [
    draft('run_stopped', { runId: run.id, why: 'delegation_lapsed' }),
    ...released,
  ]);
  return refused('delegation_lapsed', { delegationId: held.delegationId, why });
}

function leaseLive(item: ItemState, run: RunRow, at: Date): boolean {
  return heldByRun(item, run) && item.leaseExpiresAt !== null && !leaseLapsed(item, at);
}

async function stopForLease(
  tx: StoreTransaction,
  context: RecordContext,
  { item, run }: Locked,
): Promise<Refused> {
  await tx.harnessRuns.write.update(ended(run, { outcome: 'stopped' }, context.at));
  const expired = heldByRun(item, run) ? lapseDrafts(item, context.at) : [];
  await recordItemEvents(tx, context, item.itemId, [
    ...expired,
    draft('run_stopped', { runId: run.id, why: 'lease_expired' }),
  ]);
  return refused('lease_expired', { itemId: item.itemId, leaseExpiresAt: item.leaseExpiresAt });
}

export async function standingOf(
  ports: ScenePorts,
  tx: StoreTransaction,
  context: RecordContext,
  held: HeldItem,
): Promise<Standing | Refused> {
  const { seen, delegationId } = held;
  const liveness = await assertDelegationLive(tx, ports, delegationId, context.at);
  if (!liveness.live) return stopForLapse(tx, context, held, liveness);
  const harness = await tx.harnesses.read.byId(seen.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: seen.harnessId });
  const principal = beatPrincipal(liveness.delegation, liveness.grants, harness.jdArea, context.at);
  if (!allowed(principal, 'write', harness, context.at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  const locked = await lockRun(tx, held);
  if ('status' in locked) return locked;
  return { ...locked, principal, harness, capability: liveness.delegation.capability };
}

export async function sceneWithin(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: RecordContext,
  runId: string,
): Promise<KernelOutcome<RunScene>> {
  const held = await heldItem(tx, runId);
  if ('status' in held) return held;
  const { seen } = held;
  const [facts] = await tx.pages.read.facts(
    seen.personaPageId === null ? [] : [seen.personaPageId],
  );
  const persona = pinnedPersonaOf(seen, facts);
  if ('status' in persona) return persona;
  const context = { ...caller, traceId: seen.traceId };
  const standing = await standingOf(ports, tx, context, held);
  if ('status' in standing) return standing;
  const { item, run, principal, harness, capability } = standing;
  if (!leaseLive(item, run, context.at)) return stopForLease(tx, context, standing);
  return accepted({ run, item, persona, principal, harness, capability });
}

export async function runScene(
  ports: ScenePorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<RunScene>> {
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction((tx) => sceneWithin(ports, tx, context, runId));
}

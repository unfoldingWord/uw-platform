import type { CapabilityWord, Harness, ItemState, Principal, RunOutcome } from '@uw/contracts';
import { allowed, isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { beatPrincipal } from '../delegations/beat.ts';
import { assertDelegationLive, recordLapse, type Liveness } from '../delegations/live.ts';
import { lapseDrafts, leaseLapsed } from '../items/leases.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { personaOfPage } from './persona.ts';
import { ended, heldByRun } from './rows.ts';
import type { RunScene } from './types.ts';

type ScenePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type Locked = {
  readonly item: ItemState;
  readonly run: RunRow;
  readonly delegationId: string;
};

type Lapsed = Extract<Liveness, { readonly live: false }>;

type Standing = {
  readonly principal: Principal;
  readonly harness: Harness;
  readonly capability: CapabilityWord;
};

const runningOnly: readonly RunOutcome[] = ['running'];

export async function lockedRun(
  tx: StoreTransaction,
  runId: string,
  outcomes: readonly RunOutcome[] = runningOnly,
): Promise<Locked | Refused> {
  const missing = refused('run_not_found', { runId });
  const seen = await tx.harnessRuns.read.byId(runId);
  if (seen === null || seen.runShape !== 'workflow-run') return missing;
  const item = await tx.harnessItems.read.lock(seen.itemId);
  const run = await tx.harnessRuns.read.lock(runId);
  if (item === null || run === null || run.delegationId === null) return missing;
  if (!outcomes.includes(run.outcome)) {
    return refused('not_permitted', { why: `run_${run.outcome}` });
  }
  return { item, run, delegationId: run.delegationId };
}

async function stopForLapse(
  tx: StoreTransaction,
  context: RecordContext,
  { item, run, delegationId }: Locked,
  liveness: Lapsed,
): Promise<Refused> {
  await tx.harnessRuns.write.update(ended(run, { outcome: 'stopped' }, context.at));
  if (liveness.delegation !== null && liveness.why !== null) {
    await recordLapse(tx, context, liveness.delegation, liveness.why);
  }
  const released = heldByRun(item, run) ? [draft('item_released', { holder: run.persona })] : [];
  await recordItemEvents(tx, context, item.itemId, [
    draft('run_stopped', { runId: run.id, why: 'delegation_lapsed' }),
    ...released,
  ]);
  return refused('delegation_lapsed', { delegationId, why: liveness.why });
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
  locked: Locked,
): Promise<Standing | Refused> {
  const { run, delegationId } = locked;
  const liveness = await assertDelegationLive(tx, ports, delegationId, context.at);
  if (!liveness.live) return stopForLapse(tx, context, locked, liveness);
  const harness = await tx.harnesses.read.byId(run.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: run.harnessId });
  const principal = beatPrincipal(liveness.delegation, liveness.grants, harness.jdArea, context.at);
  if (!allowed(principal, 'write', harness, context.at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  return { principal, harness, capability: liveness.delegation.capability };
}

export async function sceneWithin(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: RecordContext,
  runId: string,
): Promise<KernelOutcome<RunScene>> {
  const locked = await lockedRun(tx, runId);
  if ('status' in locked) return locked;
  const { item, run } = locked;
  const context = { ...caller, traceId: run.traceId };
  const standing = await standingOf(ports, tx, context, locked);
  if ('status' in standing) return standing;
  if (!leaseLive(item, run, context.at)) return stopForLease(tx, context, locked);
  const [facts] = await tx.pages.read.facts(run.personaPageId === null ? [] : [run.personaPageId]);
  const persona = personaOfPage(facts);
  if ('status' in persona) return persona;
  return accepted({ run, item, persona, ...standing });
}

export async function runScene(
  ports: ScenePorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<RunScene>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction((tx) => sceneWithin(ports, tx, context, runId));
}

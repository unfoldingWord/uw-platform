import type {
  EventEvidence,
  ItemState,
  ReviewRecord,
  RunFailure,
  RunOutcome,
  RunResult,
  RunStop,
} from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { lapseDrafts } from '../items/leases.ts';
import {
  draft,
  readAllEvents,
  recordContext,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { ended, heldByRun } from './rows.ts';
import { heldItem, lockedRun, sceneWithin, standingOf, type Locked } from './scene.ts';

type HostPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

type Held = Locked & { readonly context: RecordContext };

type Work = (tx: StoreTransaction, held: Held) => Promise<KernelOutcome<RunRow>>;

export type CompleteInput = { readonly result: RunResult; readonly review: ReviewRecord | null };

export type FailInput = {
  readonly step: EventEvidence['run_failed']['step'];
  readonly why: RunFailure;
  readonly detail: string | null;
};

export type HaltReason = Extract<RunStop, 'gate_wait_expired' | 'lease_expired'>;

const live: readonly RunOutcome[] = ['running', 'hibernated'];
const runningOnly: readonly RunOutcome[] = ['running'];
const PRINTABLE = /^[ -~]{1,500}$/;
const REASON_LIMIT = 200;
const LINE_BREAK = /[\r\n]/;

function runContext(caller: RecordContext, run: RunRow): RecordContext {
  return { ...caller, actor: run.persona, traceId: run.traceId };
}

function onRun(
  ports: HostPorts,
  caller: Caller,
  target: { readonly runId: string; readonly outcomes: readonly RunOutcome[] },
  work: Work,
): Promise<KernelOutcome<RunRow>> {
  const base = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const locked = await lockedRun(tx, target.runId, target.outcomes);
    if ('status' in locked) return locked;
    return work(tx, { ...locked, context: runContext(base, locked.run) });
  });
}

function released(item: ItemState, run: RunRow): readonly EventDraft[] {
  return heldByRun(item, run) ? [draft('item_released', { holder: run.persona })] : [];
}

function lapsedLease({ item, run, context }: Held): readonly EventDraft[] {
  return heldByRun(item, run) ? lapseDrafts(item, context.at) : [];
}

async function endRun(
  tx: StoreTransaction,
  held: Held,
  next: RunRow,
  drafts: readonly EventDraft[],
): Promise<KernelOutcome<RunRow>> {
  await tx.harnessRuns.write.update(next);
  await recordItemEvents(tx, held.context, held.item.itemId, drafts);
  return accepted(next);
}

async function parkedByRun(tx: StoreTransaction, item: ItemState, run: RunRow): Promise<boolean> {
  if (item.gateStatus !== 'parked') return false;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const submitted = events.filter((event) => event.name === 'submitted_to_gate').at(-1);
  return submitted?.actor === run.persona && submitted.evidence['result'] === 'parked';
}

export function hibernateAtGate(
  ports: HostPorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<RunRow>> {
  const base = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const held = await heldItem(tx, runId, runningOnly);
    if ('status' in held) return held;
    const context = runContext(base, held.seen);
    const standing = await standingOf(ports, tx, context, held);
    if ('status' in standing) return standing;
    const { item, run } = standing;
    if (!(await parkedByRun(tx, item, run))) return refused('not_permitted', { why: 'not_parked' });
    const next: RunRow = { ...run, outcome: 'hibernated', hibernatedFor: 'gate' };
    await tx.harnessRuns.write.update(next);
    await recordItemEvents(tx, context, item.itemId, [
      draft('run_hibernated', { runId, why: 'gate' }),
    ]);
    return accepted(next);
  });
}

export function complete(
  ports: HostPorts,
  caller: Caller,
  runId: string,
  input: CompleteInput,
): Promise<KernelOutcome<RunRow>> {
  return onRun(ports, caller, { runId, outcomes: runningOnly }, (tx, held) => {
    if (input.result === 'decided' && held.item.gateStatus === 'parked') {
      return Promise.resolve(refused('not_permitted', { why: 'item_parked' }));
    }
    const { run, context } = held;
    return endRun(tx, held, ended(run, { outcome: 'completed' }, context.at), [
      draft('run_completed', {
        runId,
        result: input.result,
        gates: [...run.gates],
        review: input.review,
      }),
      ...released(held.item, run),
    ]);
  });
}

export function fail(
  ports: HostPorts,
  caller: Caller,
  runId: string,
  input: FailInput,
): Promise<KernelOutcome<RunRow>> {
  if (input.detail !== null && !PRINTABLE.test(input.detail)) {
    return Promise.resolve(refused('malformed_command', { why: 'detail' }));
  }
  return onRun(ports, caller, { runId, outcomes: live }, (tx, held) => {
    const next = ended(held.run, { outcome: 'failed', failure: input.why }, held.context.at);
    return endRun(tx, held, next, [
      draft('run_failed', { runId, step: input.step, why: input.why, detail: input.detail }),
      ...released(held.item, held.run),
    ]);
  });
}

export function halt(
  ports: HostPorts,
  caller: Caller,
  runId: string,
  why: HaltReason,
): Promise<KernelOutcome<RunRow>> {
  return onRun(ports, caller, { runId, outcomes: live }, (tx, held) => {
    const next = ended(held.run, { outcome: 'stopped' }, held.context.at);
    const stopped = draft('run_stopped', { runId, why });
    const lapse = why === 'lease_expired' ? lapsedLease(held) : [];
    if (lapse.length > 0) return endRun(tx, held, next, [...lapse, stopped]);
    return endRun(tx, held, next, [stopped, ...released(held.item, held.run)]);
  });
}

function reasonRefusal(reason: string): Refused | null {
  const blank = reason.trim().length === 0;
  if (!blank && reason.length <= REASON_LIMIT && !LINE_BREAK.test(reason)) return null;
  return refused('malformed_command', { why: 'reason' });
}

export async function holdPremise(
  ports: HostPorts,
  caller: Caller,
  runId: string,
  input: { readonly reason: string },
): Promise<KernelOutcome<RunRow>> {
  const denied = reasonRefusal(input.reason);
  if (denied !== null) return denied;
  const base = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await sceneWithin(ports, tx, base, runId);
    if (scene.status !== 'accepted') return scene;
    const { run, item } = scene.value;
    const context = runContext(base, run);
    const next = ended(run, { outcome: 'completed' }, context.at);
    await tx.harnessRuns.write.update(next);
    await recordItemEvents(tx, context, item.itemId, [
      draft('premise_held', { runId, reason: input.reason }),
      ...released(item, run),
      draft('run_completed', {
        runId,
        result: 'premise_held',
        gates: [...run.gates],
        review: null,
      }),
    ]);
    return accepted(next);
  });
}

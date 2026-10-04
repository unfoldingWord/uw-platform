import { deviceOwnerSegment, type Harness, type ItemState } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { Delegation, RunRow, StoreTransaction } from '../ports.ts';
import { readableHarness, type ScenePorts } from '../reads/scene.ts';
import { decidableGates } from './gates.ts';
import { WAITING_WINDOW_MS, type WaitingRow } from './types.ts';

const FAILED_RUNS_READ = 200;

type Scope = {
  readonly ports: ScenePorts;
  readonly tx: StoreTransaction;
  readonly caller: Caller;
  readonly personId: string;
  readonly at: Date;
};

function readable(scope: Scope, harnessId: string): Promise<Harness | null> {
  return readableHarness(scope.ports, scope.tx, scope.caller, harnessId, scope.at);
}

async function renewed(scope: Scope, delegation: Delegation): Promise<boolean> {
  const filter = {
    personId: scope.personId,
    persona: delegation.persona,
    harnessId: delegation.harnessId,
  };
  return (await scope.tx.delegations.read.live(filter, scope.at)).length > 0;
}

async function lapsedRows(scope: Scope): Promise<readonly WaitingRow[]> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const rows: WaitingRow[] = [];
  for (const delegation of await scope.tx.delegations.read.lapsedFor(
    scope.personId,
    since,
    scope.at,
  )) {
    const harness = await readable(scope, delegation.harnessId);
    if (harness === null || (await renewed(scope, delegation))) continue;
    rows.push({ kind: 'delegation_lapsed', harness, delegation });
  }
  return rows;
}

function theirs(personId: string, identity: string | null): boolean {
  if (identity === null) return false;
  return identity === `human:${personId}` || deviceOwnerSegment(identity) === personId;
}

async function ranOrHolds(scope: Scope, run: RunRow, item: ItemState): Promise<boolean> {
  if (theirs(scope.personId, run.persona) || theirs(scope.personId, item.holder)) return true;
  if (run.delegationId === null) return false;
  const delegation = await scope.tx.delegations.read.byId(run.delegationId);
  return delegation?.personId === scope.personId;
}

async function retried(scope: Scope, run: RunRow): Promise<boolean> {
  const ended = run.endedAt?.getTime() ?? run.startedAt.getTime();
  const runs = await scope.tx.harnessRuns.read.forItems([run.itemId]);
  return runs.some((other) => other.id !== run.id && other.startedAt.getTime() > ended);
}

async function failedRow(scope: Scope, run: RunRow): Promise<WaitingRow | null> {
  const item = await scope.tx.harnessItems.read.byId(run.itemId);
  if (item === null || !(await ranOrHolds(scope, run, item))) return null;
  const harness = await readable(scope, run.harnessId);
  if (harness === null || (await retried(scope, run))) return null;
  return { kind: 'run_failed', harness, item, run };
}

async function failedRows(scope: Scope): Promise<readonly WaitingRow[]> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const rows: WaitingRow[] = [];
  for (const run of await scope.tx.harnessRuns.read.failedSince(since, FAILED_RUNS_READ)) {
    const row = await failedRow(scope, run);
    if (row !== null) rows.push(row);
  }
  return rows;
}

export async function waitingOn(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<readonly WaitingRow[]> {
  const { personId } = caller.actor;
  if (personId === null || isAgent(caller.actor)) return [];
  const gates = await decidableGates(ports, tx, caller, at);
  const scope = { ports, tx, caller, personId, at };
  return [
    ...gates.map((gate): WaitingRow => ({ kind: 'gate', gate })),
    ...(await lapsedRows(scope)),
    ...(await failedRows(scope)),
  ];
}

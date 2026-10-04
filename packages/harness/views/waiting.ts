import type { Harness } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { Delegation, StoreTransaction } from '../ports.ts';
import { readableHarness, type ScenePorts } from '../reads/scene.ts';
import { decidableGates } from './gates.ts';
import { FAILED_RUNS_LIMIT, WAITING_WINDOW_MS, type Waiting, type WaitingRow } from './types.ts';

type FailedRows = { readonly rows: readonly WaitingRow[]; readonly capped: boolean };

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

async function readableOf(
  scope: Scope,
  harnessIds: readonly string[],
): Promise<ReadonlyMap<string, Harness>> {
  const shown = new Map<string, Harness>();
  for (const harnessId of new Set(harnessIds)) {
    const harness = await readable(scope, harnessId);
    if (harness !== null) shown.set(harnessId, harness);
  }
  return shown;
}

async function failedRows(scope: Scope): Promise<FailedRows> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const { read } = scope.tx.harnessRuns;
  const runs = await read.failedFor(scope.personId, since, FAILED_RUNS_LIMIT);
  const items = new Map(
    (await scope.tx.harnessItems.read.byIds(runs.map((run) => run.itemId))).map((item) => [
      item.itemId,
      item,
    ]),
  );
  const harnesses = await readableOf(
    scope,
    runs.map((run) => run.harnessId),
  );
  const rows = runs.flatMap((run): WaitingRow[] => {
    const item = items.get(run.itemId);
    const harness = harnesses.get(run.harnessId);
    return item === undefined || harness === undefined
      ? []
      : [{ kind: 'run_failed', harness, item, run }];
  });
  return { rows, capped: runs.length === FAILED_RUNS_LIMIT };
}

export async function waitingOn(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<Waiting> {
  const { personId } = caller.actor;
  if (personId === null || isAgent(caller.actor)) return { rows: [], failedRunsCapped: false };
  const gates = await decidableGates(ports, tx, caller, at);
  const scope = { ports, tx, caller, personId, at };
  const lapsed = await lapsedRows(scope);
  const failed = await failedRows(scope);
  return {
    rows: [...gates.map((gate): WaitingRow => ({ kind: 'gate', gate })), ...lapsed, ...failed.rows],
    failedRunsCapped: failed.capped,
  };
}

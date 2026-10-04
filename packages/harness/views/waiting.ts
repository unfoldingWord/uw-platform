import type { Harness } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { Delegation, StoreTransaction } from '../ports.ts';
import type { ScenePorts } from '../reads/scene.ts';
import { decidableGates } from './gates.ts';
import { readableHarnesses } from './readable.ts';
import {
  FAILED_RUNS_LIMIT,
  VIEW_LIMIT,
  WAITING_WINDOW_MS,
  type Waiting,
  type WaitingRow,
} from './types.ts';

type FailedRows = { readonly rows: readonly WaitingRow[]; readonly capped: boolean };

type Scope = {
  readonly tx: StoreTransaction;
  readonly personId: string;
  readonly readable: ReadonlyMap<string, Harness>;
  readonly at: Date;
};

async function renewed(scope: Scope, delegation: Delegation): Promise<boolean> {
  const filter = {
    personId: scope.personId,
    persona: delegation.persona,
    harnessId: delegation.harnessId,
  };
  return (await scope.tx.delegations.read.live(filter, scope.at)).length > 0;
}

function latestPerPersona(delegations: readonly Delegation[]): readonly Delegation[] {
  const seen = new Set<string>();
  return delegations.filter((delegation) => {
    const key = JSON.stringify([delegation.persona, delegation.harnessId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function lapsedRows(scope: Scope): Promise<readonly WaitingRow[]> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const { read } = scope.tx.delegations;
  const lapsed = await read.lapsedFor(scope.personId, since, scope.at, VIEW_LIMIT);
  const rows: WaitingRow[] = [];
  for (const delegation of latestPerPersona(lapsed)) {
    const harness = scope.readable.get(delegation.harnessId);
    if (harness === undefined || (await renewed(scope, delegation))) continue;
    rows.push({ kind: 'delegation_lapsed', harness, delegation });
  }
  return rows;
}

async function failedRows(scope: Scope): Promise<FailedRows> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const { read } = scope.tx.harnessRuns;
  const harnessIds = [...scope.readable.keys()];
  const runs = await read.failedFor(scope.personId, harnessIds, since, FAILED_RUNS_LIMIT);
  const items = new Map(
    (await scope.tx.harnessItems.read.byIds(runs.map((run) => run.itemId))).map((item) => [
      item.itemId,
      item,
    ]),
  );
  const rows = runs.flatMap((run): WaitingRow[] => {
    const item = items.get(run.itemId);
    const harness = scope.readable.get(run.harnessId);
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
  const shown = await readableHarnesses(ports, tx, caller, at);
  const readable = new Map(shown.map((harness) => [harness.id, harness]));
  const scope = { tx, personId, readable, at };
  const lapsed = await lapsedRows(scope);
  const failed = await failedRows(scope);
  return {
    rows: [...gates.map((gate): WaitingRow => ({ kind: 'gate', gate })), ...lapsed, ...failed.rows],
    failedRunsCapped: failed.capped,
  };
}

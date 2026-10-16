import { eventEvidenceSchemas, type Harness } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
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

const nothingWaiting: Waiting = {
  rows: [],
  failedRunsCapped: false,
  gatesCapped: false,
  lapsedCapped: false,
  handedCapped: false,
};

type FailedRows = { readonly rows: readonly WaitingRow[]; readonly capped: boolean };

type Scope = {
  readonly tx: StoreTransaction;
  readonly personId: string;
  readonly readable: ReadonlyMap<string, Harness>;
  readonly administered: ReadonlyMap<string, Harness>;
  readonly at: Date;
};

async function renewed(scope: Scope, delegation: Delegation): Promise<boolean> {
  const filter = {
    personId: delegation.personId,
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

type LapsedRows = { readonly rows: readonly WaitingRow[]; readonly capped: boolean };

async function lapsedRows(scope: Scope): Promise<LapsedRows> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const { read } = scope.tx.delegations;
  const lapsed = await read.lapsedFor(scope.personId, since, scope.at, VIEW_LIMIT);
  const rows: WaitingRow[] = [];
  for (const delegation of latestPerPersona(lapsed)) {
    const harness = scope.readable.get(delegation.harnessId);
    if (harness === undefined || (await renewed(scope, delegation))) continue;
    rows.push({ kind: 'delegation_lapsed', harness, delegation });
  }
  return { rows, capped: lapsed.length === VIEW_LIMIT };
}

type Orphaned = { readonly orphans: readonly Delegation[]; readonly capped: boolean };

async function orphanedDelegations(scope: Scope): Promise<Orphaned> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const query = {
    since,
    names: ['delegation_lapsed'] as const,
    agentsOnly: false,
    limit: VIEW_LIMIT,
    harnessIds: [...scope.administered.keys()],
  };
  const lapses = await scope.tx.harnessEvents.read.recent(query);
  const found = new Map<string, Delegation>();
  for (const event of lapses) {
    const id = event.evidence['delegationId'];
    if (event.evidence['why'] !== 'grant_lost' || typeof id !== 'string' || found.has(id)) continue;
    if (!scope.administered.has(event.harnessId)) continue;
    const delegation = await scope.tx.delegations.read.byId(id);
    if (delegation !== null && delegation.personId !== scope.personId) found.set(id, delegation);
  }
  return { orphans: [...found.values()], capped: lapses.length === VIEW_LIMIT };
}

async function orphanedRows(scope: Scope): Promise<LapsedRows> {
  const { orphans, capped } = await orphanedDelegations(scope);
  const rows: WaitingRow[] = [];
  for (const delegation of orphans) {
    const harness = scope.administered.get(delegation.harnessId);
    if (harness === undefined || (await renewed(scope, delegation))) continue;
    rows.push({ kind: 'delegation_lapsed', harness, delegation });
  }
  return { rows, capped };
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

type HandOff = {
  readonly itemId: string;
  readonly harness: Harness;
  readonly rounds: number | null;
};

async function handOffsTo(
  scope: Scope,
): Promise<{ readonly found: readonly HandOff[]; readonly capped: boolean }> {
  const since = new Date(scope.at.getTime() - WAITING_WINDOW_MS);
  const query = {
    since,
    names: ['handed_to_person'] as const,
    agentsOnly: false,
    limit: VIEW_LIMIT,
    harnessIds: [...scope.readable.keys()],
    evidencePerson: scope.personId,
  };
  const events = await scope.tx.harnessEvents.read.recent(query);
  const found = new Map<string, HandOff>();
  for (const event of events) {
    const evidence = eventEvidenceSchemas.handed_to_person.parse(event.evidence);
    const harness = scope.readable.get(event.harnessId);
    if (event.itemId === null || harness === undefined || found.has(event.itemId)) continue;
    found.set(event.itemId, { itemId: event.itemId, harness, rounds: evidence.rounds });
  }
  return { found: [...found.values()], capped: events.length === VIEW_LIMIT };
}

async function handedRows(scope: Scope): Promise<LapsedRows> {
  const { found, capped } = await handOffsTo(scope);
  const items = await scope.tx.harnessItems.read.byIds(found.map((handOff) => handOff.itemId));
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const holder = `human:${scope.personId}`;
  const rows = found.flatMap((handOff): WaitingRow[] => {
    const item = byId.get(handOff.itemId);
    if (item === undefined || item.holder !== holder || item.gateStatus === 'done') return [];
    return [{ kind: 'handed_to_person', harness: handOff.harness, item, rounds: handOff.rounds }];
  });
  return { rows, capped };
}

export async function waitingOn(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<Waiting> {
  const { personId } = caller.actor;
  if (personId === null || isAgent(caller.actor)) return nothingWaiting;
  const gates = await decidableGates(ports, tx, caller, at);
  const shown = await readableHarnesses(ports, tx, caller, at);
  const readable = new Map(shown.map((harness) => [harness.id, harness]));
  const administered = new Map(
    shown.filter((harness) => allowed(caller.actor, 'admin', harness, at)).map((h) => [h.id, h]),
  );
  const scope = { tx, personId, readable, administered, at };
  const own = await lapsedRows(scope);
  const orphaned = await orphanedRows(scope);
  const lapsed = { rows: [...own.rows, ...orphaned.rows], capped: own.capped || orphaned.capped };
  const failed = await failedRows(scope);
  const handed = await handedRows(scope);
  const gateRows = gates.rows.map((gate): WaitingRow => ({ kind: 'gate', gate }));
  return {
    rows: [...gateRows, ...lapsed.rows, ...failed.rows, ...handed.rows],
    failedRunsCapped: failed.capped,
    gatesCapped: gates.capped,
    lapsedCapped: lapsed.capped,
    handedCapped: handed.capped,
  };
}

import {
  delegatedMergeSchema,
  type DelegatedMerge,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type Stage,
} from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { fullSha } from '../github/identifiers.ts';
import {
  draft,
  readAllEvents,
  recordContext,
  recordItemEvents,
  type RecordContext,
} from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { DecidedBase, GateDecisionRow, Ports, StoreTransaction } from '../ports.ts';
import { exitAfterDecision, type PendingExit } from './approve-at-ship.ts';
import type { ExitPorts } from './exit.ts';
import { outcomeRecordedSince, parkingChangedSince } from './parking.ts';
import { CONNECTOR_TIMEOUT_MS } from './recover.ts';

type DelegatedExitPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store'> &
  ExitPorts;

type DelegatedExit = { readonly itemId: string; readonly advanced: boolean };
type FailedExit = { readonly itemId: string; readonly decisionId: string; readonly error: string };
export type DelegatedExits = {
  readonly exited: readonly DelegatedExit[];
  readonly failed: readonly FailedExit[];
};

const LIMIT_MAX = 50;

type Placed = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stage: Stage;
  readonly next: Stage | null;
};

function claimedSince(events: readonly HarnessEvent[], decisionId: string): boolean {
  return events.some(
    (event) =>
      event.name === 'delegated_exit_claimed' && event.evidence['decisionId'] === decisionId,
  );
}

function taken(events: readonly HarnessEvent[], decisionId: string): boolean {
  return (
    claimedSince(events, decisionId) ||
    outcomeRecordedSince(events, decisionId) ||
    parkingChangedSince(events, decisionId)
  );
}

async function placedFor(
  tx: StoreTransaction,
  row: GateDecisionRow,
  context: RecordContext,
): Promise<Placed | null> {
  const locked = await tx.harnessItems.read.lock(row.itemId);
  const harness = await tx.harnesses.read.byId(row.harnessId);
  if (locked === null || harness === null || locked.gateStatus !== 'parked') return null;
  if (taken(await readAllEvents(tx, row.harnessId, row.itemId), row.id)) return null;
  const stages = await tx.harnessStages.read.forHarness(row.harnessId);
  const stage = stages.find((entry) => entry.id === row.stageId);
  if (stage === undefined || stage.key !== locked.stageKey) return null;
  const claim = draft('delegated_exit_claimed', { decisionId: row.id });
  const { item } = await recordItemEvents(tx, context, row.itemId, [claim]);
  const nextKey = row.evidence['next'];
  return { item, harness, stage, next: stages.find((entry) => entry.key === nextKey) ?? null };
}

function pendingOf(
  placed: Placed,
  row: GateDecisionRow,
  delegated: DelegatedMerge,
  context: RecordContext,
): PendingExit {
  const head = row.evidence['head'];
  const { item, harness, stage, next } = placed;
  const approver = personPrincipal({
    personId: delegated.personId,
    email: delegated.email,
    grants: [],
    interactive: false,
  });
  return {
    item,
    stage,
    connector: 'merge',
    next,
    decisionId: row.id,
    overrideReason: null,
    repository: harness.repository,
    expectedBase: null,
    evaluatedHead: typeof head === 'string' ? head : item.expectedHead,
    harness,
    approver,
    override: false,
    context,
    delegated,
  };
}

async function baseNow(ports: DelegatedExitPorts, item: ItemState): Promise<DecidedBase | null> {
  if (item.pullRequest === null) return null;
  try {
    const facts = await ports.githubFacts.refresh(item.pullRequest);
    const sha = facts === null ? null : fullSha(facts.base);
    return facts === null || sha === null ? null : { sha, ref: facts.baseRef };
  } catch {
    return null;
  }
}

async function exitOne(
  ports: DelegatedExitPorts,
  row: GateDecisionRow,
  context: RecordContext,
): Promise<DelegatedExit | null> {
  const delegated = delegatedMergeSchema.safeParse(row.evidence['delegation']);
  if (!delegated.success) return null;
  const placed = await ports.store.transaction((tx) => placedFor(tx, row, context));
  if (placed === null) return null;
  const pending = {
    ...pendingOf(placed, row, delegated.data, context),
    expectedBase: await baseNow(ports, placed.item),
  };
  const exited = await exitAfterDecision(ports, pending);
  return { itemId: placed.item.itemId, advanced: exited.advanced };
}

async function exitEach(
  ports: DelegatedExitPorts,
  rows: readonly GateDecisionRow[],
  context: RecordContext,
): Promise<DelegatedExits> {
  const exited: DelegatedExit[] = [];
  const failed: FailedExit[] = [];
  for (const row of rows) {
    try {
      const one = await exitOne(ports, row, context);
      if (one !== null) exited.push(one);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      failed.push({ itemId: row.itemId, decisionId: row.id, error: message });
    }
  }
  return { exited, failed };
}

export async function exitDelegated(
  ports: DelegatedExitPorts,
  caller: Caller,
  input: { readonly limit: number },
): Promise<KernelOutcome<DelegatedExits>> {
  if (!isSystemPrincipal(caller.actor))
    return refused('not_permitted', { actor: caller.actor.identity });
  const at = ports.clock.now();
  const since = new Date(at.getTime() - CONNECTOR_TIMEOUT_MS);
  const limit = Math.max(1, Math.min(input.limit, LIMIT_MAX));
  const rows = await ports.store.transaction((tx) =>
    tx.gateDecisions.read.delegatedSince(since, limit),
  );
  return accepted(await exitEach(ports, rows, recordContext(ports, caller, at)));
}

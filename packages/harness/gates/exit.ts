import type { DelegatedMerge, HarnessEvent, ItemState, Stage } from '@uw/contracts';
import {
  draft,
  readAllEvents,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from '../items/record.ts';
import { exitDrafts } from '../items/transitions.ts';
import type { Refused } from '../outcome.ts';
import { PortNotWiredError } from '../port-errors.ts';
import type {
  ConnectorOutcome,
  ConnectorRequest,
  DecidedBase,
  EffectConnector,
  Ports,
  StoreTransaction,
} from '../ports.ts';
import { outcomeRecordedSince, parkingChangedSince, sameChange } from './parking.ts';
import { joinedPullRequest } from './ship-input.ts';

export type ExitPorts = Pick<Ports, 'connectors' | 'store'>;

export type ExitInput = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly connector: EffectConnector;
  readonly next: Stage | null;
  readonly decisionId: string;
  readonly overrideReason: string | null;
  readonly repository: string | null;
  readonly expectedBase: DecidedBase | null;
  readonly evaluatedHead: string | null;
  readonly delegated: DelegatedMerge | null;
};

export type ExitGuard = () => Promise<
  { readonly head: string | null } | { readonly refused: string }
>;

const REASON_LIMIT = 500;

function failureOf(error: unknown): string {
  if (error instanceof PortNotWiredError) return 'not_wired';
  return error instanceof Error ? `connector_error: ${error.name}` : 'connector_error: unknown';
}

function boundedReason(reason: string): string {
  const trimmed = reason.trim().slice(0, REASON_LIMIT);
  return trimmed === '' ? 'connector_error: no reason given' : trimmed;
}

async function runConnector(
  ports: ExitPorts,
  request: ConnectorRequest,
): Promise<ConnectorOutcome> {
  try {
    return await ports.connectors.run(request);
  } catch (error) {
    return { outcome: 'refused', reason: failureOf(error) };
  }
}

export function requestOf(context: RecordContext, input: ExitInput): ConnectorRequest {
  const { item } = input;
  return {
    connector: input.connector,
    harnessId: item.harnessId,
    itemId: item.itemId,
    traceId: context.traceId,
    pullRequest: item.pullRequest,
    joined: joinedPullRequest(item),
    expectedHead: input.evaluatedHead ?? item.expectedHead,
    expectedBase: input.expectedBase,
    repository: input.repository,
    title: item.title,
    overrideReason: input.overrideReason,
  };
}

export type ExitEntry = { readonly input: ExitInput; readonly outcome: ConnectorOutcome };

type ExitRecord = {
  readonly recorded: readonly ExitEntry[];
  readonly advanced: boolean;
  readonly refusal: Refused | null;
};

type Standing = (tx: StoreTransaction) => Promise<Refused | null>;

const nothingRecorded: ExitRecord = { recorded: [], advanced: false, refusal: null };

const standsAlways: Standing = async () => null;

function stillApproved(events: readonly HarnessEvent[], input: ExitInput, locked: ItemState) {
  const { item, stage, decisionId } = input;
  if (locked.stageKey !== stage.key || locked.gateStatus !== 'parked') return false;
  return sameChange(item, locked) && !parkingChangedSince(events, decisionId);
}

function outcomeDraft(connector: EffectConnector, outcome: ConnectorOutcome): EventDraft {
  return outcome.outcome === 'refused'
    ? draft('connector_refused', { connector, reason: boundedReason(outcome.reason) })
    : draft('connector_succeeded', { connector, detail: { ...outcome.detail } });
}

async function recordIn(
  tx: StoreTransaction,
  context: RecordContext,
  itemId: string,
  entries: readonly ExitEntry[],
  standing: Standing,
): Promise<ExitRecord> {
  const locked = await tx.harnessItems.read.lock(itemId);
  if (locked === null) return nothingRecorded;
  const refusal = await standing(tx);
  if (refusal !== null) return { ...nothingRecorded, refusal };
  const events = await readAllEvents(tx, locked.harnessId, itemId);
  const open = entries.filter((entry) => !outcomeRecordedSince(events, entry.input.decisionId));
  if (open.length === 0) return nothingRecorded;
  const advancing = open.find(
    (entry) => entry.outcome.outcome === 'succeeded' && stillApproved(events, entry.input, locked),
  );
  const exit =
    advancing === undefined
      ? []
      : exitDrafts({ kind: 'forward', from: advancing.input.stage, to: advancing.input.next });
  const outcomes = open.map((entry) => outcomeDraft(entry.input.connector, entry.outcome));
  await recordItemEvents(tx, context, itemId, [...outcomes, ...exit]);
  return { recorded: open, advanced: advancing !== undefined, refusal: null };
}

export async function recordExitOutcomes(
  ports: Pick<Ports, 'store'>,
  context: RecordContext,
  entries: readonly ExitEntry[],
  standing: Standing = standsAlways,
): Promise<ExitRecord> {
  const [first] = entries;
  if (first === undefined) return nothingRecorded;
  const { itemId } = first.input.item;
  const same = entries.filter((entry) => entry.input.item.itemId === itemId);
  return ports.store.transaction((tx) => recordIn(tx, context, itemId, same, standing));
}

function passThrough(input: ExitInput): ExitGuard {
  return async () => ({ head: input.evaluatedHead });
}

export async function exitThroughConnector(
  ports: ExitPorts,
  context: RecordContext,
  input: ExitInput,
  guard: ExitGuard = passThrough(input),
): Promise<boolean> {
  const guarded = await guard();
  if ('refused' in guarded) {
    const outcome: ConnectorOutcome = { outcome: 'refused', reason: guarded.refused };
    return (await recordExitOutcomes(ports, context, [{ input, outcome }])).advanced;
  }
  const evaluated = { ...input, evaluatedHead: guarded.head };
  const outcome = await runConnector(ports, requestOf(context, evaluated));
  return (await recordExitOutcomes(ports, context, [{ input: evaluated, outcome }])).advanced;
}

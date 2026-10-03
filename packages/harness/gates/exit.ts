import type { ItemState, Stage } from '@uw/contracts';
import {
  draft,
  readAllEvents,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from '../items/record.ts';
import { exitDrafts } from '../items/transitions.ts';
import { PortNotWiredError } from '../port-errors.ts';
import type {
  ConnectorOutcome,
  ConnectorRequest,
  EffectConnector,
  Ports,
  StoreTransaction,
} from '../ports.ts';
import { parkingChangedSince, sameChange } from './parking.ts';

export type ExitPorts = Pick<Ports, 'connectors' | 'store'>;

type ExitInput = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly connector: EffectConnector;
  readonly next: Stage | null;
  readonly decisionId: string;
  readonly overrideReason: string | null;
  readonly repository: string | null;
  readonly expectedBase: string | null;
};

const REASON_LIMIT = 500;

function messageOf(title: string, overrideReason: string | null): string {
  return overrideReason === null ? title : `${title}\n\nOverride: ${overrideReason}`;
}

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

function requestOf(context: RecordContext, input: ExitInput): ConnectorRequest {
  const { item } = input;
  return {
    connector: input.connector,
    harnessId: item.harnessId,
    itemId: item.itemId,
    traceId: context.traceId,
    pullRequest: item.pullRequest,
    expectedHead: item.expectedHead,
    expectedBase: input.expectedBase,
    repository: input.repository,
    message: messageOf(item.title, input.overrideReason),
  };
}

async function stillApproved(
  tx: StoreTransaction,
  input: ExitInput,
  locked: ItemState,
): Promise<boolean> {
  const { item, stage, decisionId } = input;
  if (locked.stageKey !== stage.key || locked.gateStatus !== 'parked') return false;
  if (!sameChange(item, locked)) return false;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  return !parkingChangedSince(events, decisionId);
}

function outcomeDraft(connector: EffectConnector, outcome: ConnectorOutcome): EventDraft {
  return outcome.outcome === 'refused'
    ? draft('connector_refused', { connector, reason: boundedReason(outcome.reason) })
    : draft('connector_succeeded', { connector, detail: { ...outcome.detail } });
}

export async function exitThroughConnector(
  ports: ExitPorts,
  context: RecordContext,
  input: ExitInput,
): Promise<boolean> {
  const { item, stage, next, connector } = input;
  const outcome = await runConnector(ports, requestOf(context, input));
  return ports.store.transaction(async (tx) => {
    const locked = await tx.harnessItems.read.lock(item.itemId);
    if (locked === null) return false;
    const advancing = outcome.outcome === 'succeeded' && (await stillApproved(tx, input, locked));
    const exit = advancing ? exitDrafts({ kind: 'forward', from: stage, to: next }) : [];
    await recordItemEvents(tx, context, item.itemId, [outcomeDraft(connector, outcome), ...exit]);
    return advancing;
  });
}

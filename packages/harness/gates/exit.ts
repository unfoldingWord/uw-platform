import type { ItemState, Stage } from '@uw/contracts';
import { draft, recordItemEvents, type RecordContext } from '../items/record.ts';
import { exitDrafts } from '../items/transitions.ts';
import { PortNotWiredError } from '../port-errors.ts';
import type { ConnectorOutcome, ConnectorRequest, EffectConnector, Ports } from '../ports.ts';

type ExitPorts = Pick<Ports, 'connectors' | 'store'>;

type ExitInput = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly next: Stage | null;
  readonly overrideReason: string | null;
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

function requestOf(
  context: RecordContext,
  connector: EffectConnector,
  input: ExitInput,
): ConnectorRequest {
  const { item } = input;
  return {
    connector,
    harnessId: item.harnessId,
    itemId: item.itemId,
    traceId: context.traceId,
    pullRequest: item.pullRequest,
    expectedHead: item.expectedHead,
    message: messageOf(item.title, input.overrideReason),
  };
}

export async function exitThroughConnector(
  ports: ExitPorts,
  context: RecordContext,
  input: ExitInput,
): Promise<boolean> {
  const { item, stage, next } = input;
  const { connector } = stage;
  if (connector === 'none') return false;
  const outcome = await runConnector(ports, requestOf(context, connector, input));
  return ports.store.transaction(async (tx) => {
    const locked = await tx.harnessItems.read.lock(item.itemId);
    if (locked === null) return false;
    const advancing = locked.stageKey === stage.key && locked.gateStatus === 'parked';
    const exit = advancing ? exitDrafts({ kind: 'forward', from: stage, to: next }) : [];
    const drafts =
      outcome.outcome === 'refused'
        ? [draft('connector_refused', { connector, reason: boundedReason(outcome.reason) })]
        : [draft('connector_succeeded', { connector, detail: { ...outcome.detail } }), ...exit];
    await recordItemEvents(tx, context, item.itemId, drafts);
    return outcome.outcome === 'succeeded' && advancing;
  });
}

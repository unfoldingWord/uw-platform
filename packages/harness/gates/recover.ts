import {
  connectorSchema,
  eventEvidenceSchemas,
  stageKeySchema,
  type Harness,
  type HarnessEvent,
  type Stage,
} from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { replay } from '../items/fold.ts';
import { readAllEvents, recordContext, type RecordContext } from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { PortNotWiredError } from '../port-errors.ts';
import type {
  ConnectorOutcome,
  EffectConnector,
  GateDecisionRow,
  Ports,
  StoreTransaction,
} from '../ports.ts';
import { adminRefusal, agentRefusal } from '../stages/rules.ts';
import { effectOf } from './approve-at-ship.ts';
import { recordExitOutcomes, requestOf, type ExitEntry, type ExitInput } from './exit.ts';
import { approvalsAwaitingOutcome } from './parking.ts';

type RecoverPorts = Pick<Ports, 'clock' | 'connectors' | 'grants' | 'ids' | 'store'>;

type RecoveredItem = { readonly itemId: string; readonly outcome: 'succeeded' | 'lost' };

export type Recovered = { readonly items: readonly RecoveredItem[] };

type Place = { readonly harness: Harness; readonly stages: readonly Stage[]; readonly at: Date };

type DecidedRoute = {
  readonly connector: EffectConnector;
  readonly next: string | null | undefined;
  readonly head: string | null;
};
type Decided = ReadonlyMap<string, DecidedRoute>;

type Scan = {
  readonly harness: Harness;
  readonly stuck: readonly ExitInput[];
  readonly context: RecordContext;
};

const CONNECTOR_TIMEOUT_MS = 15 * 60_000;

const lost: ConnectorOutcome = { outcome: 'refused', reason: 'connector_lost' };

function isRefused<T extends object>(value: T | Refused): value is Refused {
  return 'status' in value;
}

function timedOut(approval: HarnessEvent, at: Date): boolean {
  return new Date(approval.at).getTime() + CONNECTOR_TIMEOUT_MS <= at.getTime();
}

function overrideReasonOf(approval: HarnessEvent): string | null {
  const reason = approval.evidence['reason'];
  return approval.name === 'gate_overridden' && typeof reason === 'string' ? reason : null;
}

type DecidedOn = Pick<ExitInput, 'repository' | 'expectedBase'>;

function decidedOn(events: readonly HarnessEvent[], index: number): DecidedOn {
  const approval = events.at(index);
  const derived = events
    .slice(0, index)
    .findLast((event) => event.name === 'risk_derived' && event.traceId === approval?.traceId);
  const parsed = eventEvidenceSchemas.risk_derived.safeParse(derived?.evidence);
  if (!parsed.success) return { repository: null, expectedBase: null };
  return { repository: parsed.data.repository, expectedBase: parsed.data.base };
}

function decidedRoute(decided: Decided, decisionId: unknown): DecidedRoute | undefined {
  return typeof decisionId === 'string' ? decided.get(decisionId) : undefined;
}

function connectorAt(stage: Stage | undefined, recorded: DecidedRoute | undefined) {
  if (recorded !== undefined) return recorded.connector;
  return stage === undefined ? null : effectOf(stage.connector);
}

function nextAt(place: Place, stage: Stage, recorded: DecidedRoute | undefined): Stage | null {
  const key = recorded?.next;
  if (key === null) return null;
  const fixed = key === undefined ? undefined : place.stages.find((entry) => entry.key === key);
  return fixed ?? resolveExit(place.stages, stage, null)?.to ?? null;
}

function stuckAt(
  events: readonly HarnessEvent[],
  index: number,
  scope: { readonly place: Place; readonly decided: Decided },
): ExitInput | null {
  const { place } = scope;
  const approval = events.at(index);
  const item = replay(events.slice(0, index + 1));
  if (approval === undefined || item === null || !timedOut(approval, place.at)) return null;
  const decisionId = approval.evidence['decisionId'];
  const stage = place.stages.find((entry) => entry.key === item.stageKey);
  const recorded = decidedRoute(scope.decided, decisionId);
  const connector = connectorAt(stage, recorded);
  if (typeof decisionId !== 'string' || stage === undefined || connector === null) return null;
  return {
    item,
    stage,
    connector,
    next: nextAt(place, stage, recorded),
    decisionId,
    overrideReason: overrideReasonOf(approval),
    ...decidedOn(events, index),
    evaluatedHead: recorded?.head ?? null,
  };
}

const recordedNext = stageKeySchema.nullable();

function nextOf(row: GateDecisionRow): string | null | undefined {
  if (!Object.hasOwn(row.evidence, 'next')) return undefined;
  const parsed = recordedNext.safeParse(row.evidence['next']);
  return parsed.success ? parsed.data : undefined;
}

function headOf(row: GateDecisionRow): string | null {
  const head = row.evidence['head'];
  return typeof head === 'string' ? head : null;
}

function decidedConnectors(rows: readonly GateDecisionRow[]): Decided {
  return new Map(
    rows.flatMap((row) => {
      const parsed = connectorSchema.safeParse(row.evidence['connector']);
      const connector = parsed.success ? effectOf(parsed.data) : null;
      if (connector === null) return [];
      return [[row.id, { connector, next: nextOf(row), head: headOf(row) }] as const];
    }),
  );
}

function stuckIn(
  events: readonly HarnessEvent[],
  scope: { readonly place: Place; readonly decided: Decided },
): readonly ExitInput[] {
  return approvalsAwaitingOutcome(events).flatMap((index) => {
    const stuck = stuckAt(events, index, scope);
    return stuck === null ? [] : [stuck];
  });
}

async function scanIn(
  ports: RecoverPorts,
  tx: StoreTransaction,
  caller: Caller,
  request: { readonly harnessId: string; readonly at: Date },
): Promise<Scan | Refused> {
  const { harnessId, at } = request;
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId });
  const denied = await adminRefusal(ports, tx, caller, harness, at);
  if (denied !== null) return denied;
  const place = { harness, stages: await tx.harnessStages.read.forHarness(harnessId), at };
  const stuck: ExitInput[] = [];
  for (const item of await tx.harnessItems.read.forHarness(harnessId)) {
    const decided = decidedConnectors(await tx.gateDecisions.read.forItem(item.itemId));
    stuck.push(...stuckIn(await readAllEvents(tx, harnessId, item.itemId), { place, decided }));
  }
  return { harness, stuck, context: recordContext(ports, caller, at) };
}

function unread(input: ExitInput, why: string): Refused {
  return refused('facts_stale', { itemId: input.item.itemId, why });
}

function refusalOf(input: ExitInput, reason: string): Refused {
  return reason === 'not_wired'
    ? refused('not_wired', { port: 'connectors' })
    : unread(input, reason);
}

async function provenOutcome(
  ports: RecoverPorts,
  context: RecordContext,
  input: ExitInput,
): Promise<ExitEntry | Refused> {
  try {
    const answer = await ports.connectors.outcomeOf(requestOf(context, input));
    if (answer === null) return { input, outcome: lost };
    if (answer.outcome === 'succeeded') return { input, outcome: answer };
    return refusalOf(input, answer.reason);
  } catch (error) {
    if (error instanceof PortNotWiredError) return refused('not_wired', { port: error.port });
    return unread(input, 'github_unreadable');
  }
}

async function provenOutcomes(
  ports: RecoverPorts,
  scan: Scan,
): Promise<readonly ExitEntry[] | Refused> {
  const entries: ExitEntry[] = [];
  for (const input of scan.stuck) {
    const entry = await provenOutcome(ports, scan.context, input);
    if (isRefused(entry)) return entry;
    entries.push(entry);
  }
  return entries;
}

function byItem(entries: readonly ExitEntry[]): ReadonlyMap<string, readonly ExitEntry[]> {
  const grouped = new Map<string, ExitEntry[]>();
  for (const entry of entries) {
    const { itemId } = entry.input.item;
    grouped.set(itemId, [...(grouped.get(itemId) ?? []), entry]);
  }
  return grouped;
}

function recoveredOf(entry: ExitEntry): RecoveredItem {
  const outcome = entry.outcome.outcome === 'succeeded' ? 'succeeded' : 'lost';
  return { itemId: entry.input.item.itemId, outcome };
}

function personRefusal(caller: Caller): Refused | null {
  const { actor } = caller;
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  if (actor.personId === null || actor.identity !== `human:${actor.personId}`) {
    return refused('not_permitted', { actor: actor.identity });
  }
  return null;
}

export async function recoverConnectors(
  ports: RecoverPorts,
  caller: Caller,
  input: { readonly harnessId: string },
): Promise<KernelOutcome<Recovered>> {
  const notPerson = personRefusal(caller);
  if (notPerson !== null) return notPerson;
  const at = ports.clock.now();
  const request = { harnessId: input.harnessId, at };
  const scan = await ports.store.transaction((tx) => scanIn(ports, tx, caller, request));
  if (isRefused(scan)) return scan;
  const entries = await provenOutcomes(ports, scan);
  if (isRefused(entries)) return entries;
  const items: RecoveredItem[] = [];
  const standing = (tx: StoreTransaction) =>
    adminRefusal(ports, tx, caller, scan.harness, scan.context.at);
  for (const group of byItem(entries).values()) {
    const record = await recordExitOutcomes(ports, scan.context, group, standing);
    if (record.refusal !== null) return record.refusal;
    items.push(...record.recorded.map(recoveredOf));
  }
  return accepted({ items });
}

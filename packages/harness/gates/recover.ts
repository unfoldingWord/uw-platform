import type { Harness, HarnessEvent, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { replay } from '../items/fold.ts';
import { readAllEvents, recordContext, type RecordContext } from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { PortNotWiredError } from '../port-errors.ts';
import type { ConnectorOutcome, Ports, StoreTransaction } from '../ports.ts';
import { adminRefusal, agentRefusal } from '../stages/rules.ts';
import { effectOf } from './approve-at-ship.ts';
import { recordExitOutcomes, requestOf, type ExitEntry, type ExitInput } from './exit.ts';
import { approvalsAwaitingOutcome } from './parking.ts';

type RecoverPorts = Pick<Ports, 'clock' | 'connectors' | 'grants' | 'ids' | 'store'>;

type RecoveredItem = { readonly itemId: string; readonly outcome: 'succeeded' | 'lost' };

export type Recovered = { readonly items: readonly RecoveredItem[] };

type Place = { readonly harness: Harness; readonly stages: readonly Stage[]; readonly at: Date };

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

function stuckAt(events: readonly HarnessEvent[], index: number, place: Place): ExitInput | null {
  const approval = events.at(index);
  const item = replay(events.slice(0, index + 1));
  if (approval === undefined || item === null || !timedOut(approval, place.at)) return null;
  const decisionId = approval.evidence['decisionId'];
  const stage = place.stages.find((entry) => entry.key === item.stageKey);
  const connector = stage === undefined ? null : effectOf(stage.connector);
  if (typeof decisionId !== 'string' || stage === undefined || connector === null) return null;
  return {
    item,
    stage,
    connector,
    next: resolveExit(place.stages, stage, null)?.to ?? null,
    decisionId,
    overrideReason: overrideReasonOf(approval),
    repository: place.harness.repository,
    expectedBase: null,
  };
}

function stuckIn(events: readonly HarnessEvent[], place: Place): readonly ExitInput[] {
  return approvalsAwaitingOutcome(events).flatMap((index) => {
    const stuck = stuckAt(events, index, place);
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
    stuck.push(...stuckIn(await readAllEvents(tx, harnessId, item.itemId), place));
  }
  return { harness, stuck, context: recordContext(ports, caller, at) };
}

function unread(input: ExitInput, why: string): Refused {
  return refused('facts_stale', { itemId: input.item.itemId, why });
}

function refusalOf(input: ExitInput, reason: string): Refused | null {
  if (reason === 'not_wired') return refused('not_wired', { port: 'connectors' });
  return reason.startsWith('github_') ? unread(input, reason) : null;
}

async function provenOutcome(
  ports: RecoverPorts,
  context: RecordContext,
  input: ExitInput,
): Promise<ExitEntry | Refused> {
  try {
    const answer = await ports.connectors.outcomeOf(requestOf(context, input));
    if (answer === null || answer.outcome === 'succeeded') {
      return { input, outcome: answer ?? lost };
    }
    return refusalOf(input, answer.reason) ?? { input, outcome: lost };
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

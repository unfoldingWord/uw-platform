import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { AssistantStaleTurn, Ports, StoreTransaction } from '../ports.ts';
import { anyNamed, requestEvents } from './ledger.ts';
import { settleStaleProposalEffects } from './proposal-stale.ts';
import { finishedDraft, type SettledLoop } from './reply.ts';
import { assistantRole } from './role.ts';
import { claimOf, leaseHeld, settle } from './settle.ts';

export type SweepInput = { readonly limit: number };
export type Swept = {
  readonly abandoned: readonly string[];
  readonly settled: readonly string[];
  readonly unknown: readonly string[];
};

type SweepPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;
type Closed = 'abandoned' | 'settled' | null;

const STALE_TURN_MS = 60 * 60_000;
const LOOK_BACK_MS = 40 * 24 * 60 * 60_000;
const SWEEP_MOST = 200;

const abandoned: SettledLoop = {
  outcome: 'abandoned',
  text: null,
  usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
  resolvedProvider: null,
  resolvedModel: assistantRole.model,
  toolsCalled: [],
  turns: 0,
};

async function closeIn(
  tx: StoreTransaction,
  context: RecordContext,
  stale: AssistantStaleTurn,
): Promise<Closed> {
  await tx.lock(lockKeys.assistantRequest(stale.requestId));
  const request = await tx.assistantRequests.read.byId(stale.requestId);
  if (request === null) return null;
  await tx.lock(lockKeys.assistantHarness(request.harnessId));
  const events = await requestEvents(tx, request, ['assistant_turn_finished']);
  if (anyNamed(events, 'assistant_turn_finished')) return null;
  const input = { requestId: request.id, turnId: stale.turnId, result: abandoned };
  const claim = await claimOf(tx, request);
  if (claim === null) {
    await recordHarnessEvents(tx, context, request.harnessId, [finishedDraft(input)]);
    return 'abandoned';
  }
  if (claim.delivery !== null || leaseHeld(claim, context.at)) return null;
  await settle(tx, context, input, claim.effect, 'outcome_unknown');
  return 'settled';
}

async function staleTurns(ports: SweepPorts, at: Date, limit: number) {
  return ports.store.transaction((tx) =>
    tx.harnessEvents.read.assistantStaleTurns({
      startedBefore: new Date(at.getTime() - STALE_TURN_MS),
      since: new Date(at.getTime() - LOOK_BACK_MS),
      limit,
    }),
  );
}

export async function closeStaleTurns(
  ports: SweepPorts,
  caller: Caller,
  input: SweepInput,
): Promise<KernelOutcome<Swept>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > SWEEP_MOST) {
    return refused('malformed_command', { field: 'limit' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  const abandonedTurns: string[] = [];
  const settledTurns: string[] = [];
  for (const stale of await staleTurns(ports, context.at, input.limit)) {
    const closed = await ports.store.transaction((tx) => closeIn(tx, context, stale));
    if (closed === 'abandoned') abandonedTurns.push(stale.turnId);
    if (closed === 'settled') settledTurns.push(stale.turnId);
  }
  const startedBefore = new Date(context.at.getTime() - STALE_TURN_MS);
  const unknown = await settleStaleProposalEffects(ports, context, startedBefore, input.limit);
  return accepted({ abandoned: abandonedTurns, settled: settledTurns, unknown });
}

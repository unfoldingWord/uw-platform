import { assistantIdentityOf, harnessSchema } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { refused, type Refused } from '../outcome.ts';
import type { AssistantRequestRow, Ports, StoreTransaction } from '../ports.ts';
import { boundAssist } from './delegation.ts';
import { anyNamed, requestEvents, startedTurn } from './ledger.ts';

export type TurnAddress = { readonly requestId: string; readonly turnId: string };
export type TurnScene = {
  readonly tx: StoreTransaction;
  readonly context: RecordContext;
  readonly request: AssistantRequestRow;
};

type TurnScenePorts = Pick<Ports, 'grants'>;

const uuid = harnessSchema.shape.id;

export function addressed(input: TurnAddress): boolean {
  return uuid.safeParse(input.requestId).success && uuid.safeParse(input.turnId).success;
}

function ownAssistant(caller: Caller, request: AssistantRequestRow): boolean {
  const { actor } = caller;
  return (
    actor.kind === 'agent' &&
    actor.identity === assistantIdentityOf(request.personId) &&
    actor.personId === request.personId
  );
}

async function openTurnRefusal(
  tx: StoreTransaction,
  ports: TurnScenePorts,
  context: RecordContext,
  request: AssistantRequestRow,
  turnId: string,
): Promise<Refused | null> {
  const events = await requestEvents(tx, request, [
    'assistant_turn_started',
    'assistant_turn_finished',
  ]);
  const started = startedTurn(events, turnId);
  if (started === null) return refused('not_permitted', { why: 'turn_not_started', turnId });
  if (anyNamed(events, 'assistant_turn_finished')) {
    return refused('stale_version', { why: 'turn_finished', requestId: request.id });
  }
  const assist = await boundAssist(tx, ports, context, started.delegationId);
  return assist === null ? refused('delegation_required', { requestId: request.id }) : null;
}

export async function turnSceneOf(
  tx: StoreTransaction,
  ports: TurnScenePorts,
  context: RecordContext,
  caller: Caller,
  input: TurnAddress,
): Promise<TurnScene | Refused> {
  await tx.lock(lockKeys.assistantRequest(input.requestId));
  const request = await tx.assistantRequests.read.byId(input.requestId);
  if (request === null) return refused('malformed_command', { why: 'request_not_found' });
  if (!ownAssistant(caller, request)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  await tx.lock(lockKeys.assistantHarness(request.harnessId));
  const refusal = await openTurnRefusal(tx, ports, context, request, input.turnId);
  return refusal ?? { tx, context, request };
}

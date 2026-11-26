import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type {
  AssistantEffectRow,
  AssistantRequestRow,
  DirectMessage,
  Ports,
  StoreTransaction,
} from '../ports.ts';
import { boundAssist } from './delegation.ts';
import { deliver, type Delivered } from './deliver.ts';
import { replyKeyOf } from './history.ts';
import { anyNamed, requestEvents, startedTurn } from './ledger.ts';
import { replyTextOf } from './reply.ts';
import {
  claimOf,
  finishedOf,
  leaseHeld,
  sendByOf,
  settle,
  type Claim,
  type FinishInput,
  type Finished,
} from './settle.ts';

export type { FinishInput, Finished } from './settle.ts';

type FinishPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'directMessages'>;
type Scene = {
  readonly tx: StoreTransaction;
  readonly ports: FinishPorts;
  readonly context: RecordContext;
  readonly input: FinishInput;
};
type OpenTurn = {
  readonly request: AssistantRequestRow;
  readonly delegationId: string;
  readonly finished: boolean;
};
type Plan =
  | {
      readonly send: true;
      readonly request: AssistantRequestRow;
      readonly effect: AssistantEffectRow;
    }
  | { readonly send: false; readonly finished: Finished };

const REPLY = 'reply_to_requester';

async function turnIn(tx: StoreTransaction, input: FinishInput): Promise<OpenTurn | Refused> {
  await tx.lock(lockKeys.assistantRequest(input.requestId));
  const request = await tx.assistantRequests.read.byId(input.requestId);
  if (request === null) return refused('malformed_command', { why: 'request_not_found' });
  await tx.lock(lockKeys.assistantHarness(request.harnessId));
  const events = await requestEvents(tx, request, [
    'assistant_turn_started',
    'assistant_turn_finished',
  ]);
  const started = startedTurn(events, input.turnId);
  if (started === null) {
    return refused('not_permitted', { why: 'turn_not_started', turnId: input.turnId });
  }
  const finished = anyNamed(events, 'assistant_turn_finished');
  return { request, delegationId: started.delegationId, finished };
}

async function resumed(scene: Scene, turn: OpenTurn, claim: Claim): Promise<Plan | Refused> {
  const { tx, context, input } = scene;
  if (claim.delivery !== null) {
    return { send: false, finished: finishedOf(input, claim.effect, claim.delivery) };
  }
  if (leaseHeld(claim, context.at)) {
    return refused('request_in_flight', {
      why: 'delivery_in_progress',
      requestId: turn.request.id,
    });
  }
  return {
    send: false,
    finished: await settle(tx, context, input, claim.effect, 'outcome_unknown'),
  };
}

async function claimed(scene: Scene, request: AssistantRequestRow): Promise<AssistantEffectRow> {
  const { tx, context, input } = scene;
  const effect: AssistantEffectRow = {
    id: context.ids.next(),
    harnessId: request.harnessId,
    requestId: request.id,
    kind: REPLY,
    idempotencyKey: replyKeyOf(request.id),
    payload: { text: replyTextOf(input.result) },
    createdAt: context.at,
  };
  if (!(await tx.assistantEffects.write.insert(effect))) {
    throw new Error('the reply effect key is taken although no claim could be read');
  }
  await recordHarnessEvents(tx, context, request.harnessId, [
    draft('assistant_effect_started', { effectId: effect.id, requestId: request.id, kind: REPLY }),
  ]);
  return effect;
}

async function planIn(scene: Scene): Promise<Plan | Refused> {
  const { tx, ports, context, input } = scene;
  const turn = await turnIn(tx, input);
  if ('status' in turn) return turn;
  const claim = await claimOf(tx, turn.request);
  if (claim !== null) return resumed(scene, turn, claim);
  if (turn.finished) {
    return refused('stale_version', { why: 'turn_finished', requestId: turn.request.id });
  }
  const assist = await boundAssist(tx, ports, context, turn.delegationId);
  const effect = await claimed(scene, turn.request);
  if (assist !== null) return { send: true, request: turn.request, effect };
  return { send: false, finished: await settle(tx, context, input, effect, 'delegation_lapsed') };
}

function messageOf(request: AssistantRequestRow, effect: AssistantEffectRow, traceId: string) {
  const text = effect.payload['text'];
  const message: DirectMessage = {
    requestId: request.id,
    effectId: effect.id,
    personId: request.personId,
    channel: request.channel,
    replyAddress: request.replyAddress,
    threadKey: request.threadKey,
    text: typeof text === 'string' ? text : '',
    traceId,
    sendBy: sendByOf(effect),
  };
  return message;
}

async function closeIn(
  scene: Scene,
  effect: AssistantEffectRow,
  delivery: Delivered,
): Promise<KernelOutcome<Finished>> {
  const { tx, context, input } = scene;
  const turn = await turnIn(tx, input);
  if ('status' in turn) return turn;
  const claim = await claimOf(tx, turn.request);
  if (claim !== null && claim.delivery !== null) {
    return accepted(finishedOf(input, claim.effect, claim.delivery));
  }
  return accepted(await settle(tx, context, input, effect, delivery));
}

export async function finishTurn(
  ports: FinishPorts,
  caller: Caller,
  input: FinishInput,
): Promise<KernelOutcome<Finished>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  const plan = await ports.store.transaction((tx) => planIn({ tx, ports, context, input }));
  if ('status' in plan) return plan;
  if (!plan.send) return accepted(plan.finished);
  const delivery = await deliver(
    ports.directMessages,
    messageOf(plan.request, plan.effect, caller.traceId),
  );
  const closing = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction((tx) =>
    closeIn({ tx, ports, context: closing, input }, plan.effect, delivery),
  );
}

import type { AssistantEffectFailure } from '@uw/contracts';
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
import type { LoopResult } from '../runs/tool-loop.ts';
import { deliver, type Delivered } from './deliver.ts';
import { replyKeyOf } from './history.ts';
import { anyNamed, eventsSince, evidenceNamed, startedTurn } from './ledger.ts';
import { finishedDraft, replyTextOf } from './reply.ts';

export type FinishInput = {
  readonly requestId: string;
  readonly turnId: string;
  readonly result: LoopResult;
};
export type Finished = {
  readonly requestId: string;
  readonly turnId: string;
  readonly effectId: string;
  readonly delivery: Delivered;
};

type FinishPorts = Pick<Ports, 'clock' | 'ids' | 'store' | 'directMessages'>;
type Planned = {
  readonly request: AssistantRequestRow;
  readonly effect: AssistantEffectRow;
  readonly send: boolean;
};

const REPLY = 'reply_to_requester';

async function requestIn(
  tx: StoreTransaction,
  input: FinishInput,
): Promise<AssistantRequestRow | Refused> {
  await tx.lock(lockKeys.assistantRequest(input.requestId));
  const request = await tx.assistantRequests.read.byId(input.requestId);
  if (request === null) return refused('malformed_command', { why: 'request_not_found' });
  const events = evidenceNamed(
    await eventsSince(tx, request, ['assistant_turn_started', 'assistant_turn_finished']),
    'requestId',
    request.id,
  );
  if (!startedTurn(events, input.turnId)) {
    return refused('not_permitted', { why: 'turn_not_started', turnId: input.turnId });
  }
  if (anyNamed(events, 'assistant_turn_finished')) {
    return refused('stale_version', { why: 'turn_finished', requestId: request.id });
  }
  return request;
}

async function settled(tx: StoreTransaction, request: AssistantRequestRow, effectId: string) {
  const names = ['assistant_effect_done', 'assistant_effect_failed'] as const;
  return evidenceNamed(await eventsSince(tx, request, names), 'effectId', effectId).length > 0;
}

async function reuse(
  tx: StoreTransaction,
  context: RecordContext,
  request: AssistantRequestRow,
): Promise<AssistantEffectRow> {
  const effect = await tx.assistantEffects.read.byKey(request.harnessId, replyKeyOf(request.id));
  if (effect === null) throw new Error('the reply effect key conflicted but cannot be read');
  if (!(await settled(tx, request, effect.id))) {
    await recordHarnessEvents(tx, context, request.harnessId, [
      draft('assistant_effect_failed', {
        effectId: effect.id,
        kind: effect.kind,
        why: 'outcome_unknown',
      }),
    ]);
  }
  return effect;
}

async function planIn(
  tx: StoreTransaction,
  context: RecordContext,
  input: FinishInput,
): Promise<Planned | Refused> {
  const request = await requestIn(tx, input);
  if ('status' in request) return request;
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
    return { request, effect: await reuse(tx, context, request), send: false };
  }
  await recordHarnessEvents(tx, context, request.harnessId, [
    draft('assistant_effect_started', { effectId: effect.id, requestId: request.id, kind: REPLY }),
  ]);
  return { request, effect, send: true };
}

function messageOf(planned: Planned, traceId: string): DirectMessage {
  const { request, effect } = planned;
  const text = effect.payload['text'];
  return {
    requestId: request.id,
    effectId: effect.id,
    channel: request.channel,
    replyAddress: request.replyAddress,
    threadKey: request.threadKey,
    text: typeof text === 'string' ? text : '',
    traceId,
  };
}

function deliveryDraft(planned: Planned, delivery: Delivered) {
  const { effect } = planned;
  if (delivery === 'sent')
    return [draft('assistant_effect_done', { effectId: effect.id, kind: effect.kind })];
  if (delivery === 'not_sent') return [];
  const why: AssistantEffectFailure = delivery;
  return [draft('assistant_effect_failed', { effectId: effect.id, kind: effect.kind, why })];
}

async function closeIn(
  tx: StoreTransaction,
  context: RecordContext,
  input: FinishInput,
  planned: Planned,
  delivery: Delivered,
): Promise<KernelOutcome<Finished>> {
  const request = await requestIn(tx, input);
  if ('status' in request) return request;
  await recordHarnessEvents(tx, context, request.harnessId, [
    ...deliveryDraft(planned, delivery),
    finishedDraft(input),
  ]);
  return accepted({
    requestId: request.id,
    turnId: input.turnId,
    effectId: planned.effect.id,
    delivery,
  });
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
  const planned = await ports.store.transaction((tx) => planIn(tx, context, input));
  if ('status' in planned) return planned;
  const delivery = planned.send
    ? await deliver(ports.directMessages, messageOf(planned, caller.traceId))
    : 'not_sent';
  const closing = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction((tx) => closeIn(tx, closing, input, planned, delivery));
}

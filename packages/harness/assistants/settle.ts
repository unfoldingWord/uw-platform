import { assistantEffectFailureSchema, type HarnessEvent } from '@uw/contracts';
import { draft, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import type { AssistantEffectRow, AssistantRequestRow, StoreTransaction } from '../ports.ts';
import type { LoopResult } from '../runs/tool-loop.ts';
import type { Delivered } from './deliver.ts';
import { replyKeyOf } from './history.ts';
import { effectEvents } from './ledger.ts';
import { finishedDraft } from './reply.ts';

const SEND_WINDOW_MS = 5 * 60_000;
const DELIVERY_LEASE_MS = 2 * SEND_WINDOW_MS;

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
export type Claim = {
  readonly effect: AssistantEffectRow;
  readonly delivery: Delivered | null;
  readonly sendingSince: Date | null;
};

function deliveryOf(events: readonly HarnessEvent[]): Delivered | null {
  if (events.some((event) => event.name === 'assistant_effect_done')) return 'sent';
  const failed = events.find((event) => event.name === 'assistant_effect_failed');
  if (failed === undefined) return null;
  const why = assistantEffectFailureSchema.safeParse(failed.evidence['why']);
  return why.success ? why.data : 'outcome_unknown';
}

export async function claimOf(
  tx: StoreTransaction,
  request: AssistantRequestRow,
): Promise<Claim | null> {
  const effect = await tx.assistantEffects.read.byKey(request.harnessId, replyKeyOf(request.id));
  if (effect === null) return null;
  const events = await effectEvents(tx, request, effect.id, [
    'assistant_effect_started',
    'assistant_effect_done',
    'assistant_effect_failed',
  ]);
  const started = events.find((event) => event.name === 'assistant_effect_started');
  return {
    effect,
    delivery: deliveryOf(events),
    sendingSince: started === undefined ? null : new Date(started.at),
  };
}

export function leaseHeld(claim: Claim, at: Date): boolean {
  const since = claim.sendingSince;
  return since !== null && at.getTime() < since.getTime() + DELIVERY_LEASE_MS;
}

export function sendByFrom(at: Date): Date {
  return new Date(at.getTime() + SEND_WINDOW_MS);
}

export function sendByOf(effect: AssistantEffectRow): Date {
  return sendByFrom(effect.createdAt);
}

export function finishedOf(
  input: FinishInput,
  effect: AssistantEffectRow,
  delivery: Delivered,
): Finished {
  return { requestId: input.requestId, turnId: input.turnId, effectId: effect.id, delivery };
}

function deliveryDraft(effect: AssistantEffectRow, delivery: Delivered) {
  if (delivery === 'sent') {
    return draft('assistant_effect_done', { effectId: effect.id, kind: effect.kind });
  }
  return draft('assistant_effect_failed', {
    effectId: effect.id,
    kind: effect.kind,
    why: delivery,
  });
}

export async function settle(
  tx: StoreTransaction,
  context: RecordContext,
  input: FinishInput,
  effect: AssistantEffectRow,
  delivery: Delivered,
): Promise<Finished> {
  await recordHarnessEvents(tx, context, effect.harnessId, [
    deliveryDraft(effect, delivery),
    finishedDraft(input),
  ]);
  return finishedOf(input, effect, delivery);
}

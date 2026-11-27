import type { AssistantEffectKind } from '@uw/contracts';
import { draft, recordHarnessEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { AssistantEffectPayload, AssistantEffectRow } from '../ports.ts';
import type { TurnScene } from './reminder-turn.ts';

export type DraftedEffect = { readonly effectId: string; readonly status: 'drafted' };
export type Draft = {
  readonly kind: AssistantEffectKind;
  readonly payload: AssistantEffectPayload;
};

type DailyCap = { readonly most: number; readonly why: string };

const EFFECTS_PER_REQUEST_MOST = 5;
const DAY_MS = 24 * 60 * 60_000;
const REPLY = 'reply_to_requester';
const dailyCaps: Partial<Record<AssistantEffectKind, DailyCap>> = {
  reminder_set: { most: 50, why: 'reminders_capped' },
  calendar_hold_added: { most: 20, why: 'holds_capped' },
};

function samePayload(effect: AssistantEffectRow, wanted: Draft): boolean {
  if (effect.kind !== wanted.kind) return false;
  const have = new Map(Object.entries(effect.payload));
  return Object.entries(wanted.payload).every(([key, value]) => have.get(key) === value);
}

async function capRefusal(
  scene: TurnScene,
  wanted: Draft,
  drafts: number,
): Promise<Refused | null> {
  if (drafts >= EFFECTS_PER_REQUEST_MOST) {
    return refused('not_permitted', { why: 'effects_capped', requestId: scene.request.id });
  }
  const cap = dailyCaps[wanted.kind];
  if (cap === undefined) return null;
  const since = new Date(scene.context.at.getTime() - DAY_MS);
  const today = await scene.tx.assistantEffects.read.countSince(
    scene.request.harnessId,
    wanted.kind,
    since,
  );
  return today >= cap.most ? refused('not_permitted', { why: cap.why }) : null;
}

export async function drafted(
  scene: TurnScene,
  wanted: Draft,
): Promise<KernelOutcome<DraftedEffect>> {
  const { tx, context, request } = scene;
  const effects = (await tx.assistantEffects.read.forRequests([request.id])).filter(
    (effect) => effect.requestId === request.id && effect.kind !== REPLY,
  );
  const same = effects.find((effect) => samePayload(effect, wanted));
  if (same !== undefined) return accepted({ effectId: same.id, status: 'drafted' });
  const capped = await capRefusal(scene, wanted, effects.length);
  if (capped !== null) return capped;
  const effect: AssistantEffectRow = {
    id: context.ids.next(),
    harnessId: request.harnessId,
    requestId: request.id,
    kind: wanted.kind,
    idempotencyKey: `${wanted.kind}:${request.id}:${String(effects.length + 1)}`,
    payload: wanted.payload,
    createdAt: context.at,
  };
  if (!(await tx.assistantEffects.write.insert(effect))) {
    return refused('stale_version', { why: 'effect_key_taken', requestId: request.id });
  }
  await recordHarnessEvents(tx, context, request.harnessId, [
    draft('assistant_effect_started', {
      effectId: effect.id,
      requestId: request.id,
      kind: effect.kind,
    }),
  ]);
  return accepted({ effectId: effect.id, status: 'drafted' });
}

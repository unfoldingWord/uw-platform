import { verbIo, type AssistantEffectKind } from '@uw/contracts';
import { yearsAfter } from '@uw/core/dates';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { AssistantEffectPayload, AssistantEffectRow, Ports } from '../ports.ts';
import { addressed, turnSceneOf, type TurnAddress, type TurnScene } from './reminder-turn.ts';

export type SetReminderInput = TurnAddress & { readonly text: string; readonly dueAt: string };
export type CancelReminderInput = TurnAddress & { readonly reminderId: string };
export type DraftedEffect = { readonly effectId: string; readonly status: 'drafted' };

type DraftPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;
type Draft = { readonly kind: AssistantEffectKind; readonly payload: AssistantEffectPayload };

const EFFECTS_PER_REQUEST_MOST = 5;
const REMINDERS_PER_DAY_MOST = 50;
const SOONEST_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const REPLY = 'reply_to_requester';

function samePayload(effect: AssistantEffectRow, wanted: Draft): boolean {
  if (effect.kind !== wanted.kind) return false;
  const have = new Map(Object.entries(effect.payload));
  return Object.entries(wanted.payload).every(([key, value]) => have.get(key) === value);
}

async function capRefusal(
  scene: TurnScene,
  wanted: Draft,
  drafted: number,
): Promise<Refused | null> {
  if (drafted >= EFFECTS_PER_REQUEST_MOST) {
    return refused('not_permitted', { why: 'effects_capped', requestId: scene.request.id });
  }
  if (wanted.kind !== 'reminder_set') return null;
  const since = new Date(scene.context.at.getTime() - DAY_MS);
  const today = await scene.tx.assistantEffects.read.countSince(
    scene.request.harnessId,
    'reminder_set',
    since,
  );
  return today >= REMINDERS_PER_DAY_MOST
    ? refused('not_permitted', { why: 'reminders_capped' })
    : null;
}

async function drafted(scene: TurnScene, wanted: Draft): Promise<KernelOutcome<DraftedEffect>> {
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

function windowRefusal(dueAt: Date, now: Date): Refused | null {
  if (dueAt.getTime() < now.getTime() + SOONEST_MS) {
    return refused('malformed_command', { why: 'due_in_past' });
  }
  if (dueAt.getTime() > yearsAfter(now, 2).getTime()) {
    return refused('malformed_command', { why: 'due_too_far' });
  }
  return null;
}

export async function setReminder(
  ports: DraftPorts,
  caller: Caller,
  input: SetReminderInput,
): Promise<KernelOutcome<DraftedEffect>> {
  const parsed = verbIo.set_reminder.input.safeParse({ text: input.text, dueAt: input.dueAt });
  if (!parsed.success || !addressed(input)) {
    return refused('malformed_command', { why: 'reminder_input' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  const dueAt = new Date(parsed.data.dueAt);
  const outside = windowRefusal(dueAt, context.at);
  if (outside !== null) return outside;
  const wanted: Draft = {
    kind: 'reminder_set',
    payload: { text: parsed.data.text, dueAt: dueAt.toISOString() },
  };
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    return 'status' in scene ? scene : drafted(scene, wanted);
  });
}

async function cancelIn(scene: TurnScene, reminderId: string) {
  const reminder = await scene.tx.assistantReminders.read.byId(reminderId);
  if (
    reminder === null ||
    reminder.harnessId !== scene.request.harnessId ||
    reminder.status !== 'set'
  ) {
    return refused('malformed_command', { why: 'reminder_not_found', reminderId });
  }
  return drafted(scene, { kind: 'reminder_cancelled', payload: { reminderId } });
}

export async function cancelReminder(
  ports: DraftPorts,
  caller: Caller,
  input: CancelReminderInput,
): Promise<KernelOutcome<DraftedEffect>> {
  const parsed = verbIo.cancel_reminder.input.safeParse({ reminderId: input.reminderId });
  if (!parsed.success || !addressed(input)) {
    return refused('malformed_command', { why: 'reminder_input' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    return 'status' in scene ? scene : cancelIn(scene, parsed.data.reminderId);
  });
}

import { verbIo } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type EventDraft } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { AssistantEffectRow, AssistantRequestRow, Ports } from '../ports.ts';
import type { RecordContext } from '../items/record.ts';
import type { StoreTransaction } from '../ports.ts';
import { addressed, turnSceneOf, type TurnAddress } from './reminder-turn.ts';

type ListedReminder = {
  readonly reminderId: string;
  readonly text: string;
  readonly dueAt: string;
};
export type ListedReminders = { readonly reminders: readonly ListedReminder[] };

type ListPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

const LIST_MOST = 50;
const REPLY = 'reply_to_requester';

export async function listReminders(
  ports: ListPorts,
  caller: Caller,
  input: TurnAddress,
): Promise<KernelOutcome<ListedReminders>> {
  if (!addressed(input)) return refused('malformed_command', { why: 'reminder_input' });
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    if ('status' in scene) return scene;
    const rows = await tx.assistantReminders.read.pending(scene.request.harnessId, LIST_MOST);
    return accepted({
      reminders: rows.map((row) => ({
        reminderId: row.id,
        text: row.text,
        dueAt: row.dueAt.toISOString(),
      })),
    });
  });
}

function failed(effect: AssistantEffectRow, why: 'delegation_lapsed' | 'reminder_closed') {
  return draft('assistant_effect_failed', { effectId: effect.id, kind: effect.kind, why });
}

function done(effect: AssistantEffectRow): EventDraft {
  return draft('assistant_effect_done', { effectId: effect.id, kind: effect.kind });
}

async function setFrom(
  tx: StoreTransaction,
  context: RecordContext,
  request: AssistantRequestRow,
  effect: AssistantEffectRow,
): Promise<readonly EventDraft[]> {
  const payload = verbIo.set_reminder.input.parse(effect.payload);
  const reminderId = context.ids.next();
  await tx.assistantReminders.write.insert({
    id: reminderId,
    harnessId: request.harnessId,
    personId: request.personId,
    requestId: request.id,
    effectId: effect.id,
    text: payload.text,
    dueAt: new Date(payload.dueAt),
    status: 'set',
    closedAt: null,
    createdAt: context.at,
  });
  return [draft('assistant_reminder_set', { reminderId, effectId: effect.id }), done(effect)];
}

async function cancelFrom(
  tx: StoreTransaction,
  context: RecordContext,
  request: AssistantRequestRow,
  effect: AssistantEffectRow,
): Promise<readonly EventDraft[]> {
  const { reminderId } = verbIo.cancel_reminder.input.parse(effect.payload);
  const reminder = await tx.assistantReminders.read.byId(reminderId);
  const own = reminder !== null && reminder.harnessId === request.harnessId;
  const change = { id: reminderId, from: 'set' as const, to: 'cancelled' as const, at: context.at };
  if (!own || !(await tx.assistantReminders.write.close(change))) {
    return [failed(effect, 'reminder_closed')];
  }
  return [draft('assistant_reminder_cancelled', { reminderId, effectId: effect.id }), done(effect)];
}

export async function applyReminderDrafts(
  tx: StoreTransaction,
  context: RecordContext,
  request: AssistantRequestRow,
  live: boolean,
): Promise<void> {
  const drafts = (await tx.assistantEffects.read.forRequests([request.id])).filter(
    (effect) => effect.requestId === request.id && effect.kind !== REPLY,
  );
  const events: EventDraft[] = [];
  for (const effect of drafts) {
    if (!live) events.push(failed(effect, 'delegation_lapsed'));
    else if (effect.kind === 'reminder_set')
      events.push(...(await setFrom(tx, context, request, effect)));
    else if (effect.kind === 'reminder_cancelled') {
      events.push(...(await cancelFrom(tx, context, request, effect)));
    }
  }
  if (events.length > 0) await recordHarnessEvents(tx, context, request.harnessId, events);
}

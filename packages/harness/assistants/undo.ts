import { harnessSchema, type AssistantUndoRefusal } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { AssistantEffectRow, AssistantHoldRow, Ports, StoreTransaction } from '../ports.ts';
import { askCalendar, calendarRefusal } from './calendar-port.ts';
import { ownedHarness, type Owned } from './settings.ts';

export type UndoInput = { readonly effectId: string };
export type Undone = { readonly effectId: string; readonly kind: AssistantEffectRow['kind'] };

type UndoPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'workspace'>;
type Plan =
  | { readonly done: Undone }
  | {
      readonly remove: AssistantHoldRow;
      readonly owned: Owned;
      readonly effect: AssistantEffectRow;
    };

function notUndoable(why: AssistantUndoRefusal): Refused {
  return refused('effect_not_undoable', { why });
}

async function recordUndone(
  ports: UndoPorts,
  tx: StoreTransaction,
  caller: Caller,
  effect: AssistantEffectRow,
  at: Date,
): Promise<Undone> {
  await recordHarnessEvents(tx, recordContext(ports, caller, at), effect.harnessId, [
    draft('assistant_effect_undone', { effectId: effect.id, kind: effect.kind }),
  ]);
  return { effectId: effect.id, kind: effect.kind };
}

async function undoReminder(
  ports: UndoPorts,
  tx: StoreTransaction,
  caller: Caller,
  effect: AssistantEffectRow,
  at: Date,
): Promise<Plan | Refused> {
  const reminder = await tx.assistantReminders.read.byEffect(effect.id);
  if (reminder === null || reminder.status !== 'set') return notUndoable('already_closed');
  const change = { id: reminder.id, from: 'set', to: 'cancelled', at } as const;
  if (!(await tx.assistantReminders.write.close(change))) return notUndoable('already_closed');
  return { done: await recordUndone(ports, tx, caller, effect, at) };
}

async function planIn(
  ports: UndoPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: UndoInput,
  at: Date,
): Promise<Plan | Refused> {
  const effect = await tx.assistantEffects.read.byId(input.effectId);
  if (effect === null) return refused('not_permitted', { why: 'not_the_person' });
  const owned = await ownedHarness(ports, tx, caller, effect.harnessId, at);
  if ('status' in owned) return owned;
  await tx.lock(lockKeys.assistantHarness(effect.harnessId));
  if (effect.kind === 'reminder_set') return undoReminder(ports, tx, caller, effect, at);
  if (effect.kind !== 'calendar_hold_added') return notUndoable('not_undoable');
  const hold = await tx.assistantHolds.read.byId(effect.id);
  if (hold === null || hold.status !== 'held') return notUndoable('already_closed');
  if (hold.endsAt.getTime() <= at.getTime()) return notUndoable('hold_ended');
  return { remove: hold, owned, effect };
}

async function removeHold(
  ports: UndoPorts,
  caller: Caller,
  plan: Extract<Plan, { readonly remove: AssistantHoldRow }>,
): Promise<KernelOutcome<Undone>> {
  const { remove: hold, owned, effect } = plan;
  const removal = {
    personId: owned.personId,
    harnessId: owned.harnessId,
    holdId: hold.id,
    eventId: hold.eventId,
  };
  const answer = await askCalendar(() => ports.workspace.removeHold(removal));
  if (answer === 'not_wired') return calendarRefusal('not_wired');
  if (answer.outcome === 'not_own_hold') return notUndoable('not_undoable');
  if (answer.outcome !== 'released') return calendarRefusal(answer.outcome);
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.assistantHarness(owned.harnessId));
    if (!(await tx.assistantHolds.write.release({ id: hold.id, effectId: null, at }))) {
      return notUndoable('already_closed');
    }
    return accepted(await recordUndone(ports, tx, caller, effect, at));
  });
}

export async function undoEffect(
  ports: UndoPorts,
  caller: Caller,
  input: UndoInput,
): Promise<KernelOutcome<Undone>> {
  if (!harnessSchema.shape.id.safeParse(input.effectId).success) {
    return refused('malformed_command', { field: 'effectId' });
  }
  const at = ports.clock.now();
  const plan = await ports.store.transaction((tx) => planIn(ports, tx, caller, input, at));
  if ('status' in plan) return plan;
  if ('done' in plan) return accepted(plan.done);
  return removeHold(ports, caller, plan);
}

import { verbIo } from '@uw/contracts';
import { yearsAfter } from '@uw/core/dates';
import type { Caller } from '../caller.ts';
import { recordContext } from '../items/record.ts';
import { refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { drafted, type Draft, type DraftedEffect } from './effect-drafts.ts';
import { addressed, turnSceneOf, type TurnAddress, type TurnScene } from './reminder-turn.ts';

export type SetReminderInput = TurnAddress & { readonly text: string; readonly dueAt: string };
export type CancelReminderInput = TurnAddress & { readonly reminderId: string };
export type { DraftedEffect } from './effect-drafts.ts';

type DraftPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

const SOONEST_MS = 60_000;

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

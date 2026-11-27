import type { VerbContext } from '../context.ts';
import { callerOf } from '../context.ts';
import { fromKernel, refusal, turnHandler, type VerbRefusal } from '../handler.ts';

type TurnAddress = { readonly requestId: string; readonly turnId: string };

export function turnOf(context: VerbContext): TurnAddress | VerbRefusal {
  const { turn } = context;
  if (context.host !== 'assistant' || turn === undefined || turn === null) {
    return refusal('not_permitted', { why: 'assistant_turn_only' });
  }
  return turn;
}

export const setReminderVerb = turnHandler({
  name: 'set_reminder',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const drafted = await context.kernel.assistants.setReminder(callerOf(context), {
      ...turn,
      text: input.text,
      dueAt: input.dueAt,
    });
    return fromKernel(drafted, (value) => value);
  },
});

export const cancelReminderVerb = turnHandler({
  name: 'cancel_reminder',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const drafted = await context.kernel.assistants.cancelReminder(callerOf(context), {
      ...turn,
      reminderId: input.reminderId,
    });
    return fromKernel(drafted, (value) => value);
  },
});

export const listRemindersVerb = turnHandler({
  name: 'list_reminders',
  run: async (context) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const listed = await context.kernel.assistants.listReminders(callerOf(context), turn);
    return fromKernel(listed, (value) => ({ reminders: [...value.reminders] }));
  },
});

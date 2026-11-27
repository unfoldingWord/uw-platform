import { callerOf } from '../context.ts';
import { fromKernel, turnHandler } from '../handler.ts';
import { turnOf } from './assistant-reminders.ts';

export const readMyCalendarVerb = turnHandler({
  name: 'read_my_calendar',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const read = await context.kernel.assistants.readMyCalendar(callerOf(context), {
      ...turn,
      ...input,
    });
    return fromKernel(read, (value) => ({ ...value, events: [...value.events] }));
  },
});

export const findFreeTimeVerb = turnHandler({
  name: 'find_free_time',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const found = await context.kernel.assistants.findFreeTime(callerOf(context), {
      ...turn,
      ...input,
    });
    return fromKernel(found, (value) => ({
      ...value,
      slots: [...value.slots],
      unknown: [...value.unknown],
    }));
  },
});

export const holdTimeVerb = turnHandler({
  name: 'hold_time',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const drafted = await context.kernel.assistants.holdTime(callerOf(context), {
      ...turn,
      ...input,
    });
    return fromKernel(drafted, (value) => value);
  },
});

export const releaseHoldVerb = turnHandler({
  name: 'release_hold',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const drafted = await context.kernel.assistants.releaseHold(callerOf(context), {
      ...turn,
      holdId: input.holdId,
    });
    return fromKernel(drafted, (value) => value);
  },
});

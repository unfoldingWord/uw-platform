import { callerOf } from '../context.ts';
import { fromKernel, turnHandler } from '../handler.ts';
import { turnOf } from './assistant-reminders.ts';

export const proposeEmailVerb = turnHandler({
  name: 'propose_email',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const proposed = await context.kernel.assistants.proposeEmail(callerOf(context), {
      ...turn,
      payload: input,
    });
    return fromKernel(proposed, (value) => value);
  },
});

export const proposeInviteVerb = turnHandler({
  name: 'propose_invite',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const proposed = await context.kernel.assistants.proposeInvite(callerOf(context), {
      ...turn,
      payload: input,
    });
    return fromKernel(proposed, (value) => value);
  },
});

export const proposePageAppendVerb = turnHandler({
  name: 'propose_page_append',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const proposed = await context.kernel.assistants.proposePageAppend(callerOf(context), {
      ...turn,
      payload: input,
    });
    return fromKernel(proposed, (value) => value);
  },
});

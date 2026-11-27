import { callerOf } from '../context.ts';
import { fromKernel, turnHandler } from '../handler.ts';
import { turnOf } from './assistant-reminders.ts';

export const searchWebVerb = turnHandler({
  name: 'search_web',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const found = await context.kernel.assistants.searchWeb(callerOf(context), {
      ...turn,
      ...input,
    });
    return fromKernel(found, (value) => ({ results: [...value.results] }));
  },
});

export const readWebPageVerb = turnHandler({
  name: 'read_web_page',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const read = await context.kernel.assistants.readWebPage(callerOf(context), {
      ...turn,
      url: input.url,
    });
    return fromKernel(read, (value) => value);
  },
});

export const findFlightsVerb = turnHandler({
  name: 'find_flights',
  run: async (context, input) => {
    const turn = turnOf(context);
    if ('status' in turn) return turn;
    const found = await context.kernel.assistants.findFlights(callerOf(context), {
      ...turn,
      ...input,
    });
    return fromKernel(found, (value) => ({ offers: [...value.offers] }));
  },
});

import { callerOf } from '../context.ts';
import { refusal, rowFilteredHandler } from '../handler.ts';
import { harnessAreas } from './item-scene.ts';

export const pollQueue = rowFilteredHandler({
  name: 'poll_queue',
  rows: async (context, input) => {
    const polled = await context.kernel.reads.poll(callerOf(context), input, { at: context.at });
    return polled.status === 'error' ? refusal(polled.reason, polled.detail) : polled.value;
  },
  resources: async (context, _input, items) => {
    const areaOf = await harnessAreas(
      context,
      items.map((item) => item.harnessId),
    );
    return (item) => areaOf(item.harnessId);
  },
  reply: (items) => ({ status: 'accepted', output: { items: [...items] } }),
});

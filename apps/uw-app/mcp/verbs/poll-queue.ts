import { fromKernel, rowFilteredHandler } from '../handler.ts';
import { callerOf } from './item-scene.ts';

export const pollQueue = rowFilteredHandler({
  name: 'poll_queue',
  run: async (context, input) =>
    fromKernel(await context.kernel.reads.poll(callerOf(context), input), (items) => ({
      items: [...items],
    })),
});

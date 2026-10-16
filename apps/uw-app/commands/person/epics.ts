import { sameRepository } from '@uw/harness';
import { commandHandler, fromKernel } from '../handler.ts';

export const enqueueEpicCommand = commandHandler({
  name: 'enqueue_epic',
  action: 'write',
  run: async (context, body) => {
    if (!sameRepository(body.repository, context.harness?.repository ?? null)) {
      return { ok: false, reason: 'not_permitted' };
    }
    return fromKernel(
      await context.kernel.items.enqueueEpic(context.caller, {
        harnessId: context.harnessId,
        epic: { repo: body.repository, number: body.number },
      }),
    );
  },
});

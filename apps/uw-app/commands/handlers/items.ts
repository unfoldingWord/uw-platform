import { commandHandler, fromKernel } from '../handler.ts';

export const enqueueCommand = commandHandler({
  name: 'enqueue',
  action: 'write',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.items.enqueue(context.caller, {
        harnessId: context.harnessId,
        title: body.title,
        pageId: body.pageId,
        priority: 0,
        due: body.due,
        delegationId: null,
      }),
    ),
});

export const claimCommand = commandHandler({
  name: 'claim',
  action: 'write',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.items.claim(context.caller, { itemId: body.itemId, delegationId: null }),
    ),
});

export const releaseCommand = commandHandler({
  name: 'release',
  action: 'write',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.items.release(context.caller, {
        itemId: body.itemId,
        delegationId: null,
      }),
    ),
});

import { callerOf } from '../context.ts';
import { fromKernel, gatedHandler } from '../handler.ts';
import { hiddenItem, itemArea } from './item-scene.ts';

export const claimItem = gatedHandler({
  name: 'claim_item',
  hidden: hiddenItem,
  resource: itemArea,
  run: async (context, input) => {
    const claimed = await context.kernel.items.claim(callerOf(context), {
      itemId: input.itemId,
      delegationId: input.delegationId,
      adoptBranch: input.adoptBranch,
    });
    return fromKernel(claimed, (value) => ({
      itemId: value.item.itemId,
      leaseExpiresAt: value.leaseExpiresAt,
      leaseWarning: value.leaseWarning,
      branch: value.branch,
    }));
  },
});

import type { CostBasis } from '@uw/contracts';
import type { McpHost } from '../context.ts';
import { fromKernel, gatedHandler, refusal } from '../handler.ts';
import { callerOf, hiddenItem, itemArea } from './item-scene.ts';

const hostCostBasis = new Map<McpHost, CostBasis>([
  ['external', 'subscription'],
  ['workflow', 'metered'],
]);

export const recordRunStep = gatedHandler({
  name: 'record_run_step',
  hidden: hiddenItem,
  resource: itemArea,
  run: async (context, input) => {
    const expected = hostCostBasis.get(context.host) ?? null;
    if (input.costBasis !== expected) {
      return refusal('not_permitted', { why: 'cost_basis_is_the_hosts', expected });
    }
    const recorded = await context.kernel.items.recordRunStep(callerOf(context), input);
    return fromKernel(recorded, (lease) => ({ ...lease }));
  },
});

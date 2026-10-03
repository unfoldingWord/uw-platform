import type { CostBasis } from '@uw/contracts';
import { callerOf, type McpHost } from '../context.ts';
import { fromKernel, gatedHandler, refusal, type VerbInput, type VerbRefusal } from '../handler.ts';
import { hiddenItem, itemArea } from './item-scene.ts';

const hostCostBasis = new Map<McpHost, CostBasis>([
  ['external', 'subscription'],
  ['workflow', 'metered'],
]);

function hostOnlyRefusal(host: McpHost, input: VerbInput<'record_run_step'>): VerbRefusal | null {
  const expected = hostCostBasis.get(host) ?? null;
  if (input.costBasis !== expected) {
    return refusal('not_permitted', { why: 'cost_basis_is_the_hosts', expected });
  }
  if (expected === 'metered') return null;
  if (input.costMinor !== null || input.computeMinor !== null) {
    return refusal('malformed_command', { why: 'subscription_has_no_cost' });
  }
  if (input.resolvedProvider !== null) {
    return refusal('not_permitted', { why: 'provider_is_the_hosts' });
  }
  return null;
}

export const recordRunStep = gatedHandler({
  name: 'record_run_step',
  hidden: hiddenItem,
  resource: itemArea,
  run: async (context, input) => {
    const refused = hostOnlyRefusal(context.host, input);
    if (refused !== null) return refused;
    const recorded = await context.kernel.items.recordRunStep(callerOf(context), input);
    return fromKernel(recorded, (step) => ({
      leaseExpiresAt: step.leaseExpiresAt,
      leaseWarning: step.leaseWarning,
      prompts: [...step.prompts],
    }));
  },
});

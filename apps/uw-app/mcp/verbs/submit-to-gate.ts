import { callerOf } from '../context.ts';
import type { SubmitChange } from '@uw/harness';
import { fromKernel, gatedHandler, type VerbInput } from '../handler.ts';
import { hiddenItem, itemArea } from './item-scene.ts';

function changeOf(input: VerbInput<'submit_to_gate'>): SubmitChange | null {
  const { pullRequest, head } = input;
  return pullRequest && head ? { pullRequest, head } : null;
}

export const submitToGate = gatedHandler({
  name: 'submit_to_gate',
  hidden: hiddenItem,
  resource: itemArea,
  run: async (context, input) => {
    const submitted = await context.kernel.items.submit(callerOf(context), {
      itemId: input.itemId,
      to: input.to,
      evidence: input.evidence,
      change: changeOf(input),
    });
    return fromKernel(submitted, (value) => ({
      itemId: value.item.itemId,
      result: value.result,
      failures: [...value.failures],
    }));
  },
});

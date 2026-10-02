import type { Caller } from '@uw/harness';
import type { VerbContext } from '../context.ts';
import { refusal, type Found, type VerbRefusal } from '../handler.ts';

type ItemInput = { readonly itemId: string };

export function callerOf(context: VerbContext): Caller {
  return { actor: context.principal, traceId: context.traceId };
}

export function hiddenItem(input: ItemInput): VerbRefusal {
  return refusal('item_not_found', { itemId: input.itemId });
}

export async function itemArea(
  context: VerbContext,
  input: ItemInput,
): Promise<Found<null> | VerbRefusal> {
  const scene = await context.kernel.reads.item(callerOf(context), { itemId: input.itemId });
  if (scene.status === 'error') return refusal(scene.reason, scene.detail);
  return { resource: { kind: 'area', area: scene.value.harness.jdArea }, found: null };
}

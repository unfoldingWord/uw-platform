import { contextPages } from '../../pages/context.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal, type Found, type VerbInput, type VerbRefusal } from '../handler.ts';
import { callerOf, hiddenItem } from './item-scene.ts';

type ContextScope = Parameters<typeof contextPages>[2];

async function itemScope(
  context: VerbContext,
  input: VerbInput<'resolve_context'>,
): Promise<Found<ContextScope> | VerbRefusal> {
  const scene = await context.kernel.reads.item(callerOf(context), { itemId: input.itemId });
  if (scene.status === 'error') return refusal(scene.reason, scene.detail);
  const { item, stage, harness } = scene.value;
  return {
    resource: { kind: 'area', area: harness.jdArea },
    found: {
      itemPageId: item.pageId,
      instructionsPageId: stage.instructionsPageId,
      area: harness.jdArea,
    },
  };
}

export const resolveContext = gatedHandler({
  name: 'resolve_context',
  hidden: hiddenItem,
  resource: itemScope,
  run: async (context, _input, scope) => {
    const pages = await contextPages(context.db, context.principal, scope, context.at);
    return {
      status: 'accepted',
      output: {
        instructions: pages.instructions,
        package: [...pages.package],
        learnings: [...pages.learnings],
      },
    };
  },
});

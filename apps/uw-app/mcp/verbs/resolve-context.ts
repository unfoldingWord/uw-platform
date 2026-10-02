import { contextPages } from '../../pages/context.ts';
import { callerOf, type VerbContext } from '../context.ts';
import { gatedHandler, refusal, type Found, type VerbInput, type VerbRefusal } from '../handler.ts';
import { hiddenItem } from './item-scene.ts';

type ContextScope = Parameters<typeof contextPages>[2];

async function itemScope(
  context: VerbContext,
  input: VerbInput<'resolve_context'>,
): Promise<Found<ContextScope> | VerbRefusal> {
  const scene = await context.kernel.reads.item(
    callerOf(context),
    { itemId: input.itemId },
    { at: context.at },
  );
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
    const { db, principal, at, logger } = context;
    const dropped = (pageId: string) =>
      logger.warn('learning frontmatter invalid', { outcome: 'learning_dropped', pageId });
    const pages = await contextPages(db, principal, scope, at, dropped);
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

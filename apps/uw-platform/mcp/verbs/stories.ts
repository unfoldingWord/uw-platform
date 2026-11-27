import { expressionArea } from '../../stories/expression-rows.ts';
import {
  addStoryExpression,
  updateStoryExpression,
  type ExpressionOutcome,
} from '../../stories/expressions.ts';
import { storyRecordFor } from '../../stories/story-records.ts';
import { storyPageOf } from '../../stories/story-pages.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal, type Found, type VerbRefusal, type VerbReply } from '../handler.ts';

type StoryInput = { readonly storyId: string };
type ExpressionInput = { readonly expressionId: string };

const hiddenStory = (input: StoryInput) => refusal('page_not_found', { pageId: input.storyId });
const hiddenExpression = (input: ExpressionInput) =>
  refusal('expression_not_found', { expressionId: input.expressionId });

async function storyArea(
  context: VerbContext,
  input: StoryInput,
): Promise<Found<null> | VerbRefusal> {
  const story = await storyPageOf(context.db, input.storyId);
  if (story === null) return hiddenStory(input);
  return { resource: { kind: 'area', area: story.jdArea }, found: null };
}

async function expressionStoryArea(
  context: VerbContext,
  input: ExpressionInput,
): Promise<Found<null> | VerbRefusal> {
  const area = await expressionArea(context.db, input.expressionId);
  if (area === null) return hiddenExpression(input);
  return { resource: { kind: 'area', area }, found: null };
}

type Told = VerbReply<'add_story_expression'> & VerbReply<'update_story_expression'>;

function replied(outcome: ExpressionOutcome, hidden: () => VerbRefusal): Told {
  if (!outcome.ok) return outcome.reason === 'page_not_found' ? hidden() : refusal(outcome.reason);
  const { expressionId, created, status, flags } = outcome;
  return { status: 'accepted', output: { expressionId, created, status, flags: [...flags] } };
}

export const addStoryExpressionVerb = gatedHandler({
  name: 'add_story_expression',
  hidden: hiddenStory,
  resource: storyArea,
  run: async (context, input) => {
    const { storyId, ...fields } = input;
    const adding = { pageId: storyId, ...fields };
    const outcome = await addStoryExpression(context.db, context.principal, adding, context.at);
    return replied(outcome, () => hiddenStory(input));
  },
});

export const updateStoryExpressionVerb = gatedHandler({
  name: 'update_story_expression',
  hidden: hiddenExpression,
  resource: expressionStoryArea,
  run: async (context, input) => {
    const outcome = await updateStoryExpression(context.db, context.principal, input, context.at);
    return replied(outcome, () => hiddenExpression(input));
  },
});

export const readStoryVerb = gatedHandler({
  name: 'read_story',
  hidden: hiddenStory,
  resource: storyArea,
  run: async (context, input) => {
    const story = await storyRecordFor(context.db, context.principal, input.storyId, context.at);
    if (story === null) return hiddenStory(input);
    return { status: 'accepted', output: { story } };
  },
});

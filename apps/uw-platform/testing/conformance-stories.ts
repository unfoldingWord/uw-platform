import type { ErrorReason } from '@uw/contracts';

type Call = { readonly verb: string; readonly args: Readonly<Record<string, unknown>> };

const telling = {
  title: 'A telling from conformance',
  format: 'other',
  venue: 'Conformance',
  channel: 'platform',
  url: 'https://files.example.org/tellings/conformance',
  language: null,
  publishedOn: null,
  excerpt: null,
};

export function storyCalls(): Call[] {
  const storyId = crypto.randomUUID();
  return [
    { verb: 'add_story_expression', args: { storyId, ...telling } },
    { verb: 'update_story_expression', args: { expressionId: crypto.randomUUID(), ...telling } },
    { verb: 'read_story', args: { storyId } },
    { verb: 'list_stories', args: { query: 'conformance' } },
  ];
}

export const storyOutcomes = new Map<string, 'accepted' | ErrorReason>([
  ['add_story_expression', 'page_not_found'],
  ['update_story_expression', 'expression_not_found'],
  ['read_story', 'page_not_found'],
  ['list_stories', 'accepted'],
]);

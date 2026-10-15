import { promptText, renderUntrusted, type PromptText, type UntrustedContent } from '@uw/harness';

export type PromptSource = {
  readonly title: PromptText;
  readonly context: UntrustedContent;
  readonly prompts: readonly string[];
  readonly related: readonly UntrustedContent[];
};

export type ReviewSource = PromptSource & { readonly diff: UntrustedContent };

const CONTEXT_LIMIT = 60_000;

function promptLines(prompts: readonly string[]): readonly string[] {
  if (prompts.length === 0) return [];
  return ['', 'Messages from the people who own this run:', ...prompts.map((text) => `- ${text}`)];
}

function relatedLines(related: readonly UntrustedContent[]): readonly string[] {
  if (related.length === 0) return [];
  return [
    '',
    'Text from outside the platform that this item refers to:',
    ...related.map((content) => renderUntrusted(content)),
  ];
}

function framed(source: PromptSource): readonly string[] {
  return [
    `Item: ${promptText(source.title)}`,
    '',
    'Context:',
    renderUntrusted(source.context),
    ...relatedLines(source.related),
    ...promptLines(source.prompts),
  ];
}

export function contextText(reply: string): string {
  return reply.slice(0, CONTEXT_LIMIT);
}

export function scoutPrompt(source: PromptSource): string {
  return [
    ...framed(source),
    '',
    'Before any work starts, decide whether the premise of this item still holds.',
    'Open your answer with this block and nothing before it:',
    '```harness-scout',
    'premise: holds',
    'reason: <one line>',
    '```',
    'Write `premise: held` when the item should not be worked as written.',
  ].join('\n');
}

export function workPrompt(source: PromptSource): string {
  return [...framed(source), '', 'Do the work this item asks for with the tools you hold.'].join(
    '\n',
  );
}

export function reviewPrompt(source: ReviewSource): string {
  return [
    ...framed(source),
    '',
    'The change to review, as a diff of the head against its base:',
    renderUntrusted(source.diff),
    '',
    'Open your answer with this block and nothing before it, then one finding per line:',
    '```harness-verdict',
    'verdict: approve',
    '```',
    '- <finding>',
    'Write `verdict: request_changes` when the change must not ship as it is.',
  ].join('\n');
}

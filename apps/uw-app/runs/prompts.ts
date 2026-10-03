export type PromptSource = {
  readonly title: string;
  readonly context: string;
  readonly prompts: readonly string[];
};

const CONTEXT_LIMIT = 60_000;

function promptLines(prompts: readonly string[]): readonly string[] {
  if (prompts.length === 0) return [];
  return ['', 'Messages from the people who own this run:', ...prompts.map((text) => `- ${text}`)];
}

function framed(source: PromptSource): readonly string[] {
  return [
    `Item: ${source.title}`,
    '',
    'Context:',
    source.context.slice(0, CONTEXT_LIMIT),
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

export function reviewPrompt(source: PromptSource & { readonly diff: string }): string {
  return [
    ...framed(source),
    '',
    'The change to review, as a diff of the head against its base:',
    source.diff,
    '',
    'Open your answer with this block and nothing before it, then one finding per line:',
    '```harness-verdict',
    'verdict: approve',
    '```',
    '- <finding>',
    'Write `verdict: request_changes` when the change must not ship as it is.',
  ].join('\n');
}

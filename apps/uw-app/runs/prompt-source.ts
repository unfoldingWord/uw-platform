import type { ItemState, UntrustedSource } from '@uw/contracts';
import { untrusted } from '@uw/harness';
import type { PromptSource, ReviewSource } from './prompts.ts';

export type ReadText = {
  readonly title: string;
  readonly titleSource: UntrustedSource | null;
  readonly context: string;
  readonly prompts: readonly string[];
  readonly comments: readonly string[];
};

export function titleSourceOf(
  item: Pick<ItemState, 'issue' | 'pullRequest'>,
): UntrustedSource | null {
  if (item.issue !== null) return 'issue_body';
  return item.pullRequest === null ? null : 'pr_title';
}

export function promptSourceOf(read: ReadText, itemId: string): PromptSource {
  const wrapped = (source: UntrustedSource, text: string) => untrusted({ source, itemId, text });
  return {
    title: read.titleSource === null ? read.title : wrapped(read.titleSource, read.title),
    context: wrapped('page_from_agent', read.context),
    prompts: read.prompts,
    related: read.comments.map((text) => wrapped('review_comment', text)),
  };
}

export function reviewSourceOf(read: ReadText, itemId: string, diff: string): ReviewSource {
  return {
    ...promptSourceOf(read, itemId),
    diff: untrusted({ source: 'pr_diff', itemId, text: diff }),
  };
}

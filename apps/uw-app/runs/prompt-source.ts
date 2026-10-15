import type { UntrustedSource } from '@uw/contracts';
import { untrusted } from '@uw/harness';
import type { PromptSource, ReviewSource } from './prompts.ts';

export type ReadText = {
  readonly title: string;
  readonly fromIssue: boolean;
  readonly context: string;
  readonly prompts: readonly string[];
};

export function promptSourceOf(read: ReadText, itemId: string): PromptSource {
  const wrapped = (source: UntrustedSource, text: string) => untrusted({ source, itemId, text });
  return {
    title: read.fromIssue ? wrapped('issue_body', read.title) : read.title,
    context: wrapped('page_from_agent', read.context),
    prompts: read.prompts,
    related: [],
  };
}

export function reviewSourceOf(read: ReadText, itemId: string, diff: string): ReviewSource {
  return {
    ...promptSourceOf(read, itemId),
    diff: untrusted({ source: 'pr_diff', itemId, text: diff }),
  };
}

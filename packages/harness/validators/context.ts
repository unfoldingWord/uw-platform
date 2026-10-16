import type { EventEvidence, HarnessEvent, ItemState, PullRequestDeclaration } from '@uw/contracts';
import type { DiffStat } from '../github/diff-stat.ts';
import type { PageFacts } from '../ports.ts';

export type FixContext = {
  readonly pull: DiffStat | null;
  readonly fix: DiffStat | null;
  readonly declared: PullRequestDeclaration | null;
  readonly declaration: PullRequestDeclaration | null;
  readonly claimed: boolean;
};

export type ValidationContext = {
  readonly item: ItemState;
  readonly events: readonly HarnessEvent[];
  readonly pages: ReadonlyMap<string, PageFacts>;
  readonly attaching: readonly Attachment[];
  readonly fix?: FixContext | null;
};
export type Attachment = EventEvidence['learning_attached'];
export type Validator = (context: ValidationContext) => readonly string[];

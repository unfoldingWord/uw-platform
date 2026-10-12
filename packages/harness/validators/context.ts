import type { EventEvidence, HarnessEvent, ItemState } from '@uw/contracts';
import type { PageFacts } from '../ports.ts';

export type ValidationContext = {
  readonly item: ItemState;
  readonly events: readonly HarnessEvent[];
  readonly pages: ReadonlyMap<string, PageFacts>;
  readonly attaching: readonly Attachment[];
};
export type Attachment = EventEvidence['learning_attached'];
export type Validator = (context: ValidationContext) => readonly string[];

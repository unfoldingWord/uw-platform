import { formatInstant } from '@uw/core/dates';
import { Note } from '@uw/ui/components/note.tsx';
import type { PendingReviewSet } from '../../pages/review-sets.ts';
import { pageLink } from './page-shown.ts';
import { pageReviewSetPath } from './paths.ts';

export function ReviewSetsWaiting(props: {
  readonly pageId: string;
  readonly sets: readonly PendingReviewSet[];
}) {
  if (props.sets.length === 0) return null;
  return (
    <div data-review-sets-waiting="" class="flex flex-col gap-2">
      {props.sets.map((set) => (
        <Note>
          {`${set.name}, suggested on ${formatInstant(set.createdAt)}, waits for a decision. `}
          <a href={pageReviewSetPath(props.pageId, set.id)} class={pageLink}>
            Review the suggested changes
          </a>
        </Note>
      ))}
    </div>
  );
}

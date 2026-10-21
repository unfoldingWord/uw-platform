import { formatInstant } from '@uw/core/dates';
import type { DelegatedMergeList } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { mergedCapNote } from './caps.ts';
import { itemPath } from './paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

export function DelegatedMerges(props: { readonly merged: DelegatedMergeList }) {
  const { rows, capped } = props.merged;
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="delegated-merges-heading" class="mt-6 flex flex-col gap-2">
      <h2 id="delegated-merges-heading" class="m-0 text-base font-bold text-ink">
        Merged under a delegation
      </h2>
      {capped ? <Note>{mergedCapNote}</Note> : null}
      <ul class="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row) => (
          <li class="flex flex-col gap-1">
            <a
              href={itemPath(row.harness.id, row.itemId)}
              class={`break-words text-link underline ${focus}`}
            >
              {`${row.title} on ${row.harness.key}`}
            </a>
            <span class="break-words text-sm text-muted">
              {`Merged under a delegation granted by ${row.email} until ${formatInstant(row.expiresAt)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

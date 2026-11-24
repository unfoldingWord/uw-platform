import { formatInstant } from '@uw/core/dates';
import type { DelegatedMergeList, DelegatedMergeRow } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { mergedCapNote } from './caps.ts';
import type { Holding } from './holder.tsx';
import { Person } from './person.tsx';
import { itemPath } from './paths.ts';

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function GrantedBy(props: {
  readonly row: DelegatedMergeRow;
  readonly holding?: Holding | undefined;
}) {
  const { row, holding } = props;
  const until = `until ${formatInstant(row.expiresAt)}`;
  const person = holding?.names.get(row.personId);
  if (holding === undefined || person === undefined) {
    return <>{`Merged under a delegation granted by ${row.email} ${until}`}</>;
  }
  return (
    <span class="inline-flex flex-wrap items-center gap-1">
      <span>Merged under a delegation granted by</span>
      <Person reading={holding.reading} person={person} />
      <span>{until}</span>
    </span>
  );
}

export function DelegatedMerges(props: {
  readonly merged: DelegatedMergeList;
  readonly holding?: Holding;
}) {
  const { rows, capped } = props.merged;
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="delegated-merges-heading" class="mt-5 flex flex-col gap-2">
      <h2 id="delegated-merges-heading" class="m-0 text-base font-heavy text-text">
        Merged under a delegation
      </h2>
      {capped ? <Note>{mergedCapNote}</Note> : null}
      <ul class="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row) => (
          <li class="flex flex-col gap-1">
            <a
              href={itemPath(row.harness.id, row.itemId)}
              class={`break-words text-accent-text underline ${focus}`}
            >
              {`${row.title} on ${row.harness.title}`}
            </a>
            <span class="break-words text-sm text-text-3">
              <GrantedBy row={row} holding={props.holding} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

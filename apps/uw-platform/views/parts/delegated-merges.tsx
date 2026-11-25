import { formatInstant } from '@uw/core/dates';
import type { DelegatedMergeList, DelegatedMergeRow } from '@uw/harness';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { mergedCapNote } from './caps.ts';
import type { Holding } from './holder.tsx';
import { Person } from './person.tsx';
import { itemPath } from './paths.ts';

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
    <Section title="Merged under a delegation" headingId="delegated-merges-heading">
      {capped ? <Note>{mergedCapNote}</Note> : null}
      <RowList label="Merged under a delegation">
        {rows.map((row) => (
          <ListRow
            title={<span class="break-words">{`${row.title} on ${row.harness.title}`}</span>}
            href={itemPath(row.harness.id, row.itemId)}
            meta={
              <span class="break-words">
                <GrantedBy row={row} holding={props.holding} />
              </span>
            }
          />
        ))}
      </RowList>
    </Section>
  );
}

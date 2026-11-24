import type { Holder } from '@uw/harness';
import type { PersonName } from '../../people/directory.ts';
import { heldFor, holderText, holderWords } from './holder-words.ts';
import type { Executor } from '@uw/db/client';
import { namesOf, personIdOf, Person, type Reading } from './person.tsx';

export type Holding = {
  readonly reading: Reading;
  readonly names: ReadonlyMap<string, PersonName>;
};

export function HolderOf(props: { readonly holder: Holder | null; readonly holding: Holding }) {
  const { holder, holding } = props;
  const id = holder?.kind === 'person' ? personIdOf(holder.identity) : null;
  const person = id === null ? undefined : holding.names.get(id);
  if (holder === null || person === undefined) {
    return <>{holderText(holder, holding.reading.at)}</>;
  }
  const time = heldFor(holder, holding.reading.at);
  return (
    <span>
      {`${holderWords(holder)} `}
      <Person reading={holding.reading} person={person} />
      {time === null ? '' : `, for ${time}`}
    </span>
  );
}

export async function holdingOf(
  db: Executor | null,
  reading: Reading,
  identities: readonly (string | null | undefined)[],
): Promise<Holding> {
  return { reading, names: db === null ? new Map() : await namesOf(db, identities) };
}

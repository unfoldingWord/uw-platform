import { PersonChip, type PersonChipPerson } from '@uw/ui/components/person-chip.tsx';
import type { Executor } from '@uw/db/client';
import { personNames, type PersonName } from '../../people/directory.ts';
import { can } from '@uw/core/acl';
import { personPath } from './paths.ts';
import { personIdOf, type Reading, type Someone } from './person-names.ts';

export {
  namesOf,
  personIdOf,
  shownIdentity,
  shownPerson,
  shownText,
  type Reading,
  type Someone,
} from './person-names.ts';

function chipFor(reading: Reading, person: PersonName): PersonChipPerson {
  const href = can(reading.reader, 'read', { kind: 'person', ...person }, reading.at)
    ? personPath(person.personId)
    : undefined;
  return { name: person.displayName, href };
}

export function Person(props: { readonly reading: Reading; readonly person: PersonName }) {
  return <PersonChip person={chipFor(props.reading, props.person)} />;
}

export function Who(props: { readonly reading: Reading; readonly who: Someone }) {
  const { who } = props;
  if (who.kind === 'text') return <>{who.text}</>;
  if (who.kind === 'agent') {
    return (
      <>
        An agent for <Person reading={props.reading} person={who.person} />
      </>
    );
  }
  return <Person reading={props.reading} person={who.person} />;
}

export type PersonChips = ReadonlyMap<string, PersonChipPerson>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function personIdIn(value: string): string | null {
  return personIdOf(value) ?? (uuid.test(value) ? value : null);
}

export async function personChipsFor(
  db: Executor,
  reading: Reading,
  values: readonly string[],
): Promise<PersonChips> {
  const ids = values.map(personIdIn).filter((id): id is string => id !== null);
  const found = await personNames(db, ids);
  return new Map(
    values.flatMap((value): [string, PersonChipPerson][] => {
      const person = found.get(personIdIn(value) ?? '');
      return person === undefined ? [] : [[value, chipFor(reading, person)]];
    }),
  );
}

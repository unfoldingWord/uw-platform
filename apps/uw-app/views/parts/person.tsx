import { PersonChip, type PersonChipPerson } from '@uw/ui/components/person-chip.tsx';
import type { Executor } from '@uw/db/client';
import { personNames, type PersonName } from '../../people/directory.ts';
import { can } from '@uw/core/acl';
import { personPath } from './paths.ts';
import type { Reading, Someone } from './person-names.ts';

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
  return <Person reading={props.reading} person={who.person} />;
}

export type PersonChips = ReadonlyMap<string, PersonChipPerson>;

export async function personChipsFor(
  db: Executor,
  reading: Reading,
  personIds: readonly string[],
): Promise<PersonChips> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const found = await personNames(
    db,
    personIds.filter((id) => uuid.test(id)),
  );
  return new Map([...found].map(([id, person]) => [id, chipFor(reading, person)]));
}

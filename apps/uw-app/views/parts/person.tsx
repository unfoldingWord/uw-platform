import { PersonChip, type PersonChipPerson } from '@uw/ui/components/person-chip.tsx';
import type { PersonName } from '../../people/directory.ts';
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
    ? personPath(person.personId, person.displayName)
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

import type { PersonStatus } from '@uw/contracts';
import { can, readableAreas } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';

export type ReadablePerson = {
  readonly personId: string;
  readonly status: PersonStatus | null;
};

function isPersonAtTheKeyboard(reader: Principal): boolean {
  return reader.kind === 'person' && reader.personId !== null;
}

function readsAnything(reader: Principal, at: Date): boolean {
  const areas = readableAreas(reader, at);
  return areas.kind === 'all' || areas.areas.length > 0;
}

export function readsPerson(reader: Principal, person: ReadablePerson, at: Date): boolean {
  if (!isPersonAtTheKeyboard(reader)) return false;
  if (reader.personId === person.personId) return true;
  if (can(reader, 'admin', { kind: 'org' }, at)) return true;
  return person.status !== 'pending' && person.status !== 'disabled' && readsAnything(reader, at);
}

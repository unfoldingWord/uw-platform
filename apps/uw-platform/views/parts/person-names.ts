import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { personNames, type PersonName } from '../../people/directory.ts';

export type Reading = { readonly reader: Principal; readonly at: Date };

const HUMAN = 'human:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function personIdOf(identity: string | null | undefined): string | null {
  if (identity?.startsWith(HUMAN) !== true) return null;
  const id = identity.slice(HUMAN.length);
  return uuid.test(id) ? id : null;
}

export type Someone =
  | { readonly kind: 'person'; readonly person: PersonName }
  | { readonly kind: 'agent'; readonly person: PersonName }
  | { readonly kind: 'text'; readonly text: string };

export function shownPerson(person: PersonName): Someone {
  return { kind: 'person', person };
}

export function shownText(text: string): Someone {
  return { kind: 'text', text };
}

export function shownIdentity(
  identity: string | null | undefined,
  names: ReadonlyMap<string, PersonName>,
  otherwise: (identity: string) => string,
): Someone {
  const id = personIdOf(identity);
  const person = id === null ? undefined : names.get(id);
  if (person !== undefined) return shownPerson(person);
  return shownText(otherwise(identity ?? ''));
}

export function namesOf(
  db: Executor,
  identities: readonly (string | null | undefined)[],
): Promise<ReadonlyMap<string, PersonName>> {
  return personNames(
    db,
    identities.map(personIdOf).filter((id): id is string => id !== null),
  );
}

const AGENT = 'agent:';

function agentPersonOf(identity: string): string | null {
  if (!identity.startsWith(AGENT)) return null;
  const id = identity.slice(AGENT.length).split('/')[0] ?? '';
  return uuid.test(id) ? id : null;
}

export async function shownAuthor(db: Executor | null, identity: string): Promise<Someone> {
  const agentPerson = agentPersonOf(identity);
  const ids = [personIdOf(identity), agentPerson].filter((id): id is string => id !== null);
  const names = db === null ? new Map<string, PersonName>() : await personNames(db, ids);
  const named = shownIdentity(identity, names, () => identity);
  if (named.kind === 'person' || agentPerson === null) return named;
  const bound = names.get(agentPerson);
  return bound === undefined ? shownText('An agent') : { kind: 'agent', person: bound };
}

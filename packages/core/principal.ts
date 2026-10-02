import { principalSchema, systemIdentity, type Grant, type Principal } from '@uw/contracts';

export type { Grant, Principal };

export const INGEST_IDENTITY = 'agent:ingest';

const leadingCharacter = /^[a-z0-9]/;

export function personPrincipal(person: {
  readonly personId: string;
  readonly email: string;
  readonly grants: readonly Grant[];
  readonly interactive: boolean;
}): Principal {
  return principalSchema.parse({
    identity: `human:${person.personId}`,
    kind: 'person',
    personId: person.personId,
    email: person.email,
    grants: [...person.grants],
    interactive: person.interactive,
  });
}

export function serviceTokenPrincipal(clientId: string): Principal {
  const segment = clientId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!leadingCharacter.test(segment)) {
    throw new RangeError(
      'a service token client id must leave a name starting with a letter or digit',
    );
  }
  return principalSchema.parse({
    identity: `agent:svc-${segment}`,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function ingestPrincipal(): Principal {
  return principalSchema.parse({
    identity: INGEST_IDENTITY,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function systemPrincipal(): Principal {
  return principalSchema.parse({
    identity: systemIdentity,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function parsePrincipal(value: unknown): Principal {
  return principalSchema.parse(value);
}

import { can } from '@uw/core/acl';
import { personPrincipal, type Principal } from '@uw/core/principal';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import type { Executor, Transaction } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import { lockPerson, personById } from '../people/directory.ts';

const HUMAN_PREFIX = 'human:';

export async function freshPerson(
  tx: Transaction,
  actor: Principal,
  at: Date,
): Promise<Principal | null> {
  if (actor.kind !== 'person' || actor.personId === null) return null;
  await tx.execute(advisoryLock(advisoryLocks.grantCommands));
  const person = await lockPerson(tx, actor.personId);
  if (person?.status !== 'active') return null;
  const grants = await resolveGrants(tx, actor.personId, { at, lock: 'share' });
  return { ...actor, grants };
}

export async function personActing(
  db: Executor,
  personId: string,
  at: Date,
): Promise<Principal | null> {
  const person = await personById(db, personId);
  if (person?.status !== 'active') return null;
  const grants = await resolveGrants(db, personId, { at });
  return personPrincipal({ personId, email: person.email, grants, interactive: false });
}

export function personIdOf(identity: string): string | null {
  return identity.startsWith(HUMAN_PREFIX) ? identity.slice(HUMAN_PREFIX.length) : null;
}

export function administers(actor: Principal, area: string, at: Date): boolean {
  return actor.kind === 'person' && can(actor, 'admin', { kind: 'area', area }, at);
}

import type { Principal } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import { personById } from '../people/directory.ts';

export async function actorAsOf(tx: Executor, actor: Principal, at: Date): Promise<Principal> {
  const nobody = { ...actor, grants: [] };
  if (actor.personId === null) return nobody;
  const found = await personById(tx, actor.personId);
  if (found?.status !== 'active') return nobody;
  const live = await resolveGrants(tx, actor.personId, { at, lock: 'share' });
  const liveIds = new Set(live.map((grant) => grant.grantId));
  return { ...actor, grants: actor.grants.filter((grant) => liveIds.has(grant.grantId)) };
}

import { adminAreas, type ReadableAreas } from '@uw/core/acl';
import type { Caller } from '../caller.ts';
import type { Ports, StoreTransaction } from '../ports.ts';

const none: ReadableAreas = { kind: 'some', areas: [] };

export async function creatableAreas(
  ports: Pick<Ports, 'grants'>,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<ReadableAreas> {
  const { actor } = caller;
  if (actor.kind !== 'person' || actor.personId === null) return none;
  const grants = await ports.grants.resolveIn(tx, actor.personId, at);
  return adminAreas({ ...actor, grants: [...grants] }, at);
}

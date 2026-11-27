import { can } from '@uw/core/acl';
import type { Caller } from '../caller.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';

export async function orgAdminRefusal(
  ports: Pick<Ports, 'grants'>,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<Refused | null> {
  const { actor } = caller;
  if (actor.kind !== 'person' || actor.personId === null || !actor.interactive) {
    return refused('not_permitted', { actor: actor.identity });
  }
  const grants = await ports.grants.lockAndReread(tx, actor.personId, at);
  return can({ ...actor, grants: [...grants] }, 'admin', { kind: 'org' }, at)
    ? null
    : refused('not_permitted', { actor: actor.identity });
}

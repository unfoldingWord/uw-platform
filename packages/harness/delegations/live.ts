import type { DelegationLapse, Grant } from '@uw/contracts';
import { draft, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';
import { adminGrantOn } from './beat.ts';

export type Liveness =
  | { readonly live: true; readonly delegation: Delegation; readonly grants: readonly Grant[] }
  | {
      readonly live: false;
      readonly delegation: Delegation | null;
      readonly why: DelegationLapse | null;
    };

function lapsed(delegation: Delegation, why: DelegationLapse): Liveness {
  return { live: false, delegation, why };
}

async function holdsAdmin(
  tx: StoreTransaction,
  ports: Pick<Ports, 'grants'>,
  delegation: Delegation,
  at: Date,
): Promise<readonly Grant[] | null> {
  const harness = await tx.harnesses.read.byId(delegation.harnessId);
  if (harness === null) return null;
  const grants = await ports.grants.resolveIn(tx, delegation.personId, at);
  return adminGrantOn(delegation, grants, harness.jdArea, at) === null ? null : grants;
}

export async function assertDelegationLive(
  tx: StoreTransaction,
  ports: Pick<Ports, 'grants'>,
  delegationId: string,
  at: Date,
): Promise<Liveness> {
  const delegation = await tx.delegations.read.byId(delegationId);
  if (delegation === null) return { live: false, delegation: null, why: null };
  if (delegation.revokedAt !== null) return lapsed(delegation, 'revoked');
  if (delegation.expiresAt.getTime() <= at.getTime()) return lapsed(delegation, 'expired');
  const grants = await holdsAdmin(tx, ports, delegation, at);
  if (grants === null || delegation.lapsedAt !== null) return lapsed(delegation, 'grant_lost');
  return { live: true, delegation, grants };
}

export async function recordLapse(
  tx: StoreTransaction,
  context: RecordContext,
  delegation: Delegation,
  why: DelegationLapse,
): Promise<void> {
  if (!(await tx.delegations.write.markLapsed(delegation.id, context.at))) return;
  await recordHarnessEvents(tx, context, delegation.harnessId, [
    draft('delegation_lapsed', { delegationId: delegation.id, why }),
  ]);
}

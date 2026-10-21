import type { DelegatedMerge, Principal } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { livenessOf, recordLapse } from '../delegations/live.ts';
import type { RecordContext } from '../items/record.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';
import type { ShipDelegation } from './ship-input.ts';

type LentPorts = Pick<Ports, 'grants'>;

export type Lent = {
  readonly delegation: Delegation;
  readonly approver: Principal;
  readonly lent: ShipDelegation;
};

export type NotLent = 'delegation_required' | 'delegation_lapsed';

export type LendingInput = {
  readonly delegationId: string;
  readonly email: string | null;
  readonly context: RecordContext;
};

function lentOf(delegation: Delegation, approver: Principal): Lent | NotLent {
  if (delegation.maxTier === null) return 'delegation_required';
  return {
    delegation,
    approver,
    lent: { delegationId: delegation.id, maxTier: delegation.maxTier },
  };
}

export async function lentInDecision(
  ports: LentPorts,
  tx: StoreTransaction,
  input: LendingInput,
): Promise<Lent | NotLent> {
  const { context } = input;
  const delegation = await tx.delegations.read.lock(input.delegationId);
  if (delegation === null || delegation.capability !== 'merge') return 'delegation_required';
  const liveness = await livenessOf(tx, ports, delegation, context.at);
  if (!liveness.live) {
    if (liveness.why !== null) await recordLapse(tx, context, delegation, liveness.why);
    return 'delegation_lapsed';
  }
  if (input.email === null) return 'delegation_lapsed';
  const grants = await ports.grants.lockAndReread(tx, delegation.personId, context.at);
  const approver = personPrincipal({
    personId: delegation.personId,
    email: input.email,
    grants,
    interactive: false,
  });
  return lentOf(delegation, approver);
}

export async function lentAtExit(
  ports: Pick<Ports, 'grants' | 'store'>,
  delegated: DelegatedMerge,
  at: Date,
): Promise<Lent | NotLent> {
  return ports.store.transaction(async (tx) => {
    const delegation = await tx.delegations.read.byId(delegated.delegationId);
    if (delegation?.capability !== 'merge') return 'delegation_lapsed';
    if (delegation.personId !== delegated.personId) return 'delegation_lapsed';
    const liveness = await livenessOf(tx, ports, delegation, at);
    if (!liveness.live) return 'delegation_lapsed';
    const approver = personPrincipal({
      personId: delegation.personId,
      email: delegated.email,
      grants: liveness.grants,
      interactive: false,
    });
    return lentOf(delegation, approver);
  });
}

import { isProvisionerPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';

type RevokePorts = Pick<Ports, 'clock' | 'ids'>;

export async function revokeLeaverAssistIn(
  ports: RevokePorts,
  tx: StoreTransaction,
  caller: Caller,
  delegation: Delegation,
  at: Date,
): Promise<boolean> {
  if (!isProvisionerPrincipal(caller.actor) || delegation.capability !== 'assist') return false;
  if (!(await tx.delegations.write.revoke(delegation.id, at))) return false;
  await recordHarnessEvents(tx, recordContext(ports, caller, at), delegation.harnessId, [
    draft('delegation_revoked', { delegationId: delegation.id }),
  ]);
  return true;
}

import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { markLapse } from './live.ts';

type ExpiryPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

export type ExpiryInput = { readonly limit: number };
export type Expired = { readonly lapsed: readonly string[] };

async function lapseOne(
  tx: StoreTransaction,
  context: RecordContext,
  delegationId: string,
): Promise<boolean> {
  const delegation = await tx.delegations.read.byId(delegationId);
  if (delegation === null || delegation.revokedAt !== null || delegation.lapsedAt !== null) {
    return false;
  }
  if (delegation.expiresAt.getTime() > context.at.getTime()) return false;
  const drafts = await markLapse(tx, context.at, delegation, 'expired');
  await recordHarnessEvents(tx, context, delegation.harnessId, drafts);
  return drafts.length > 0;
}

export async function lapseExpired(
  ports: ExpiryPorts,
  caller: Caller,
  input: ExpiryInput,
): Promise<KernelOutcome<Expired>> {
  const at = ports.clock.now();
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const context = recordContext(ports, caller, at);
  const expired = await ports.store.transaction((tx) =>
    tx.delegations.read.expiredUnlapsed(at, input.limit),
  );
  const lapsed: string[] = [];
  for (const delegation of expired) {
    const one = await ports.store.transaction((tx) => lapseOne(tx, context, delegation.id));
    if (one) lapsed.push(delegation.id);
  }
  return accepted({ lapsed });
}

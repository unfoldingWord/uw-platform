import type { ItemState, Principal } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { withFreshGrants } from './claim.ts';
import { lapseDrafts } from './leases.ts';
import { draft, recordContext, recordItemEvents } from './record.ts';

type ReleasePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ReleaseInput = { readonly itemId: string; readonly delegationId: string | null };

function bareAgent(identity: string): boolean {
  return identity.startsWith('agent:') && !identity.includes('/');
}

async function holdsClaim(
  tx: StoreTransaction,
  item: ItemState,
  actor: Principal,
  input: ReleaseInput,
): Promise<boolean> {
  if (item.holder === null || item.holder !== actor.identity) return false;
  if (!bareAgent(item.holder)) return true;
  if (input.delegationId !== item.delegationId) return false;
  if (input.delegationId === null) return true;
  const delegation = await tx.delegations.read.byId(input.delegationId);
  return delegation !== null && delegation.personId === actor.personId;
}

export function release(
  ports: ReleasePorts,
  caller: Caller,
  input: ReleaseInput,
): Promise<KernelOutcome<ItemState>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(input.itemId);
    if (item === null) return refused('item_not_found', { itemId: input.itemId });
    const harness = await tx.harnesses.read.byId(item.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
    const fresh = await withFreshGrants(ports, tx, caller.actor, at);
    const holds =
      (await holdsClaim(tx, item, caller.actor, input)) && allowed(fresh, 'write', harness, at);
    if (item.holder === null || !(holds || allowed(caller.actor, 'admin', harness, at))) {
      return refused('not_holder', { itemId: item.itemId });
    }
    const lapse = lapseDrafts(item, at);
    const drafts = lapse.length > 0 ? lapse : [draft('item_released', { holder: item.holder })];
    const recorded = await recordItemEvents(
      tx,
      recordContext(ports, caller, at),
      item.itemId,
      drafts,
    );
    return accepted(recorded.item);
  });
}

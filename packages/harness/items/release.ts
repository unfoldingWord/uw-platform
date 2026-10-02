import type { Harness, ItemState, Principal } from '@uw/contracts';
import { allowed, bareAgent, isAgent, ownerBound } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal } from '../delegations/acting.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { lapseDrafts } from './leases.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from './record.ts';

type ReleasePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ReleaseInput = { readonly itemId: string; readonly delegationId: string | null };

export async function holdsClaim(
  tx: StoreTransaction,
  item: ItemState,
  actor: Principal,
  input: ReleaseInput,
): Promise<boolean> {
  if (!ownerBound(actor)) return false;
  if (item.holder === null || item.holder !== actor.identity) return false;
  if (!bareAgent(item.holder)) return true;
  if (input.delegationId === null || input.delegationId !== item.delegationId) return false;
  const delegation = await tx.delegations.read.byId(input.delegationId);
  return delegation !== null && delegation.personId === actor.personId;
}

function adminOverride(fresh: Principal, harness: Harness, at: Date): boolean {
  return !isAgent(fresh) && allowed(fresh, 'admin', harness, at);
}

type Release = {
  readonly caller: Caller;
  readonly input: ReleaseInput;
  readonly item: ItemState;
  readonly harness: Harness;
  readonly context: RecordContext;
};

async function releaseRefusal(
  ports: ReleasePorts,
  tx: StoreTransaction,
  { caller, input, item, harness, context }: Release,
): Promise<Refused | null> {
  const notHolder = refused('not_holder', { itemId: item.itemId });
  const { at } = context;
  if (await holdsClaim(tx, item, caller.actor, input)) {
    const delegationId = input.delegationId;
    const acting = await actingPrincipal(ports, tx, { caller, harness, delegationId, context });
    if (isRefusal(acting)) return acting;
    return allowed(acting, 'write', harness, at) ? null : notHolder;
  }
  const fresh = await actingPrincipal(ports, tx, { caller, harness, delegationId: null, context });
  return !isRefusal(fresh) && adminOverride(fresh, harness, at) ? null : notHolder;
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
    if (item.holder === null) return refused('not_holder', { itemId: item.itemId });
    const context = recordContext(ports, caller, at);
    const denied = await releaseRefusal(ports, tx, { caller, input, item, harness, context });
    if (denied !== null) return denied;
    const lapse = lapseDrafts(item, at);
    const drafts = lapse.length > 0 ? lapse : [draft('item_released', { holder: item.holder })];
    const recorded = await recordItemEvents(tx, context, item.itemId, drafts);
    return accepted(recorded.item);
  });
}

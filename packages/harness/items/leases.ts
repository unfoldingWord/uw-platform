import type { Identity, ItemState } from '@uw/contracts';
import type { StoreTransaction } from '../ports.ts';
import { draft, recordItemEvents, type EventDraft, type RecordContext } from './record.ts';

export const LEASE_MS = 15 * 60 * 1000;
export const LEASE_WARNING_MS = 3 * 60 * 1000;

type LapsedItem = ItemState & { readonly holder: Identity; readonly leaseExpiresAt: string };

export function leaseLapsed(item: ItemState, at: Date): item is LapsedItem {
  if (item.holder === null || item.leaseExpiresAt === null) return false;
  return new Date(item.leaseExpiresAt).getTime() <= at.getTime();
}

export function lapseDrafts(item: ItemState, at: Date): readonly EventDraft[] {
  if (!leaseLapsed(item, at)) return [];
  const expired = draft('lease_expired', {
    holder: item.holder,
    leaseExpiresAt: item.leaseExpiresAt,
  });
  return item.branchState === 'active'
    ? [expired, draft('branch_abandoned', { head: item.expectedHead })]
    : [expired];
}

export async function expireLapsedLease(
  tx: StoreTransaction,
  context: RecordContext,
  item: ItemState,
): Promise<ItemState> {
  const drafts = lapseDrafts(item, context.at);
  if (drafts.length === 0) return item;
  const recorded = await recordItemEvents(tx, context, item.itemId, drafts);
  return recorded.item;
}

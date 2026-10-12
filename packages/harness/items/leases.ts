import type { Identity, ItemState } from '@uw/contracts';
import type { StoreTransaction } from '../ports.ts';
import { endRunDrafts } from '../runs/ends.ts';
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

export type Lapsed = { readonly item: ItemState; readonly hosted: string | null };

export async function lapseLease(
  tx: StoreTransaction,
  context: RecordContext,
  item: ItemState,
): Promise<Lapsed> {
  const drafts = lapseDrafts(item, context.at);
  if (drafts.length === 0) return { item, hosted: null };
  const ending = await endRunDrafts(tx, item, {
    outcome: 'stopped',
    why: 'lease_expired',
    at: context.at,
  });
  const recorded = await recordItemEvents(tx, context, item.itemId, [...drafts, ...ending.drafts]);
  return { item: recorded.item, hosted: ending.hosted };
}

export async function expireLapsedLease(
  tx: StoreTransaction,
  context: RecordContext,
  item: ItemState,
): Promise<ItemState> {
  return (await lapseLease(tx, context, item)).item;
}

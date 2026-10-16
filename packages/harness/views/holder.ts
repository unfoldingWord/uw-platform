import type { Identity, ItemState, Stage } from '@uw/contracts';
import type { StoreTransaction } from '../ports.ts';

export const PERSON_HOLD_MS = 24 * 3_600_000;
export const AGENT_HOLD_MS = 2 * 3_600_000;

export type HolderRole = 'claimant' | 'reviewer' | 'decider';
export type Holder = {
  readonly role: HolderRole;
  readonly kind: 'agent' | 'person';
  readonly identity: Identity | null;
  readonly since: Date | null;
};
export type HeldTooLong = 'person' | 'agent' | null;

function sinceOf(item: ItemState): Date | null {
  return item.heldSince === null ? null : new Date(item.heldSince);
}

export function holderOf(
  item: ItemState,
  stage: Pick<Stage, 'exitGate'> | undefined,
  reviewing: boolean,
): Holder | null {
  if (item.gateStatus === 'done') return null;
  const since = sinceOf(item);
  if (item.holder !== null) {
    const kind = item.claimantKind === 'agent' ? 'agent' : 'person';
    return { role: reviewing ? 'reviewer' : 'claimant', kind, identity: item.holder, since };
  }
  if (item.gateStatus === 'parked' && stage?.exitGate === 'human_approval') {
    return { role: 'decider', kind: 'person', identity: null, since };
  }
  return null;
}

export function heldTooLong(holder: Holder | null, at: Date): HeldTooLong {
  if (holder === null || holder.since === null) return null;
  const held = at.getTime() - holder.since.getTime();
  if (holder.kind === 'person') return held > PERSON_HOLD_MS ? 'person' : null;
  return held > AGENT_HOLD_MS ? 'agent' : null;
}

export async function reviewingIds(
  tx: StoreTransaction,
  items: readonly ItemState[],
): Promise<ReadonlySet<string>> {
  const reviews = new Map<string, boolean>();
  const reviewing = new Set<string>();
  for (const item of items) {
    const { delegationId } = item;
    if (item.holder === null || delegationId === null) continue;
    if (!reviews.has(delegationId)) {
      const delegation = await tx.delegations.read.byId(delegationId);
      reviews.set(delegationId, delegation?.capability === 'review');
    }
    if (reviews.get(delegationId) === true) reviewing.add(item.itemId);
  }
  return reviewing;
}

import type { Harness, ItemState, PageStatus, PageType } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal } from '../delegations/acting.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { expireLapsedLease, leaseLapsed } from './leases.ts';
import {
  draft,
  recordContext,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from './record.ts';
import { holdsClaim } from './release.ts';

type LearningPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type AttachLearningInput = {
  readonly itemId: string;
  readonly pageId: string;
  readonly delegationId: string | null;
};
export type NothingLearnedInput = { readonly itemId: string; readonly reason: string };

const maxReason = 200;
const lineBreak = /[\r\n]/;

type Standing = {
  readonly item: ItemState;
  readonly harness: Harness;
};

const learningTypes: ReadonlySet<PageType> = new Set<PageType>(['learning', 'skill']);
const revisionTypes: ReadonlySet<PageType> = new Set<PageType>([
  'product',
  'system_goal',
  'product_strategy',
  'data_sources',
]);
const revisionStatuses: ReadonlySet<PageStatus> = new Set<PageStatus>(['draft', 'suggested']);

export async function attachWithin(
  tx: StoreTransaction,
  harness: Pick<Harness, 'jdArea'>,
  pageId: string,
): Promise<Refused | EventDraft> {
  const [page] = await tx.pages.read.facts([pageId]);
  if (page?.jdArea !== harness.jdArea) return refused('page_not_found', { pageId });
  if (learningTypes.has(page.type) && page.status === 'suggested') {
    return draft('learning_attached', { pageId: page.id, kind: 'learning' });
  }
  if (revisionTypes.has(page.type) && revisionStatuses.has(page.status)) {
    return draft('learning_attached', { pageId: page.id, kind: 'revision' });
  }
  return refused('malformed_command', { pageId: page.id, type: page.type, status: page.status });
}

export function isAttachRefusal(value: Refused | EventDraft): value is Refused {
  return 'status' in value;
}

async function presentedDelegation(
  tx: StoreTransaction,
  caller: Caller,
  item: ItemState,
  delegationId: string | null,
): Promise<Refused | { readonly delegationId: string | null }> {
  if (!isAgent(caller.actor)) return { delegationId };
  const held = { itemId: item.itemId, delegationId: item.delegationId };
  if (!(await holdsClaim(tx, item, caller.actor, held))) {
    return refused('not_holder', { itemId: item.itemId });
  }
  if (delegationId !== null && delegationId !== item.delegationId) {
    return refused('not_permitted', { delegationId });
  }
  return { delegationId: item.delegationId };
}

async function lapsedLeaseRefusal(
  tx: StoreTransaction,
  context: RecordContext,
  item: ItemState,
): Promise<Refused | null> {
  if (!leaseLapsed(item, context.at)) return null;
  await expireLapsedLease(tx, context, item);
  return refused('lease_expired', { itemId: item.itemId, leaseExpiresAt: item.leaseExpiresAt });
}

async function standing(
  ports: LearningPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly itemId: string; readonly delegationId: string | null },
  at: Date,
): Promise<Refused | Standing> {
  const { itemId } = input;
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  const presented = await presentedDelegation(tx, caller, item, input.delegationId);
  if ('status' in presented) return presented;
  const { delegationId } = presented;
  const context = recordContext(ports, caller, at);
  const actor = await actingPrincipal(ports, tx, { caller, harness, delegationId, context });
  if (isRefusal(actor)) return actor;
  if (!allowed(actor, 'write', harness, at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  if (!isAgent(caller.actor)) return { item, harness };
  return (await lapsedLeaseRefusal(tx, context, item)) ?? { item, harness };
}

function isStandingRefusal(value: Refused | Standing): value is Refused {
  return 'status' in value;
}

export function attachLearning(
  ports: LearningPorts,
  caller: Caller,
  input: AttachLearningInput,
): Promise<KernelOutcome<ItemState>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const scene = await standing(ports, tx, caller, input, at);
    if (isStandingRefusal(scene)) return scene;
    const attached = await attachWithin(tx, scene.harness, input.pageId);
    if (isAttachRefusal(attached)) return attached;
    const recorded = await recordItemEvents(
      tx,
      recordContext(ports, caller, at),
      scene.item.itemId,
      [attached],
    );
    return accepted(recorded.item);
  });
}

function reasonRefusal(reason: string): Refused | null {
  const line = reason.trim();
  if (line.length === 0) return refused('reason_required');
  if (lineBreak.test(line) || line.length > maxReason) return refused('reason_not_one_line');
  return null;
}

export function markNothingLearned(
  ports: LearningPorts,
  caller: Caller,
  input: NothingLearnedInput,
): Promise<KernelOutcome<ItemState>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    if (isAgent(caller.actor)) return refused('not_permitted', { itemId: input.itemId });
    const scene = await standing(
      ports,
      tx,
      caller,
      { itemId: input.itemId, delegationId: null },
      at,
    );
    if (isStandingRefusal(scene)) return scene;
    const unacceptable = reasonRefusal(input.reason);
    if (unacceptable !== null) return unacceptable;
    const recorded = await recordItemEvents(
      tx,
      recordContext(ports, caller, at),
      scene.item.itemId,
      [draft('nothing_learned', { reason: input.reason.trim() })],
    );
    return accepted(recorded.item);
  });
}

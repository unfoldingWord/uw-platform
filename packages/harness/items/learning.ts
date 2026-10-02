import type { ItemState } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal } from '../delegations/acting.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { draft, recordContext, recordItemEvents } from './record.ts';
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
};

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
  return { delegationId: item.delegationId };
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
  return { item };
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
    const [page] = await tx.pages.read.facts([input.pageId]);
    if (page === undefined) return refused('page_not_found', { pageId: input.pageId });
    const learning = page.type === 'learning' || page.type === 'skill';
    if (!learning || page.status !== 'suggested') {
      return refused('malformed_command', {
        pageId: page.id,
        type: page.type,
        status: page.status,
      });
    }
    const recorded = await recordItemEvents(
      tx,
      recordContext(ports, caller, at),
      scene.item.itemId,
      [draft('learning_attached', { pageId: page.id })],
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

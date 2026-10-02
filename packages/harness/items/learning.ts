import type { ItemState } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { withFreshGrants } from './claim.ts';
import { draft, recordContext, recordItemEvents } from './record.ts';

type LearningPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type AttachLearningInput = { readonly itemId: string; readonly pageId: string };
export type NothingLearnedInput = { readonly itemId: string; readonly reason: string };

const maxReason = 200;
const lineBreak = /[\r\n]/;

type Standing = {
  readonly item: ItemState;
};

async function standing(
  ports: LearningPorts,
  tx: StoreTransaction,
  caller: Caller,
  itemId: string,
  at: Date,
): Promise<Refused | Standing> {
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  const actor = await withFreshGrants(ports, tx, caller.actor, at);
  if (!allowed(actor, 'write', harness, at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  return { item };
}

function isRefusal(value: Refused | Standing): value is Refused {
  return 'status' in value;
}

export function attachLearning(
  ports: LearningPorts,
  caller: Caller,
  input: AttachLearningInput,
): Promise<KernelOutcome<ItemState>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const scene = await standing(ports, tx, caller, input.itemId, at);
    if (isRefusal(scene)) return scene;
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
    const scene = await standing(ports, tx, caller, input.itemId, at);
    if (isRefusal(scene)) return scene;
    if (caller.actor.kind === 'agent') {
      return refused('not_permitted', { itemId: input.itemId });
    }
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

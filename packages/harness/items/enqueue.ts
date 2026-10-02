import type { ItemState } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal } from '../delegations/acting.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { createItem, recordContext } from './record.ts';

type EnqueuePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type EnqueueInput = {
  readonly harnessId: string;
  readonly title: string;
  readonly pageId: string | null;
  readonly priority: number;
  readonly due: string | null;
  readonly delegationId: string | null;
};

export async function enqueue(
  ports: EnqueuePorts,
  caller: Caller,
  input: EnqueueInput,
): Promise<KernelOutcome<ItemState>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const context = recordContext(ports, caller, at);
    const { delegationId } = input;
    const actor = await actingPrincipal(ports, tx, { caller, harness, delegationId, context });
    if (isRefusal(actor)) return actor;
    if (!allowed(actor, 'write', harness, at)) {
      return refused('not_permitted', { harnessId: harness.id });
    }
    const stages = await tx.harnessStages.read.forHarness(harness.id);
    const first = stages.reduce<(typeof stages)[number] | null>(
      (lowest, stage) => (lowest === null || stage.position < lowest.position ? stage : lowest),
      null,
    );
    if (first === null) return refused('stage_not_found', { harnessId: harness.id });
    const recorded = await createItem(tx, context, {
      itemId: ports.ids.next(),
      harnessId: harness.id,
      stageKey: first.key,
      title: input.title,
      pageId: input.pageId,
      priority: input.priority,
      due: input.due,
    });
    return accepted(recorded.item);
  });
}

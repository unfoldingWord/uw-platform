import type { Harness } from '@uw/contracts';
import type { Caller } from '../../caller.ts';
import { recordContext, recordHarnessEvents, type EventDraft } from '../../items/record.ts';
import { lockKeys } from '../../lock-keys.ts';
import { refused, type KernelOutcome } from '../../outcome.ts';
import type { Ports, StoreTransaction } from '../../ports.ts';
import { personalRefusal } from '../guards.ts';
import { adminRefusal } from '../rules.ts';
import type { HeldDraft } from '../../store-ports.ts';

export type DraftPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type DraftScope = {
  readonly tx: StoreTransaction;
  readonly harness: Harness;
  readonly at: Date;
  readonly personId: string;
  readonly held: HeldDraft | null;
  record(events: readonly EventDraft[]): Promise<void>;
};

export type DraftWork<T> = (scope: DraftScope) => Promise<KernelOutcome<T>>;

export function withDraft<T>(
  ports: DraftPorts,
  caller: Caller,
  harnessId: string,
  work: DraftWork<T>,
): Promise<KernelOutcome<T>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessStages(harnessId));
    const harness = await tx.harnesses.read.byId(harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId });
    const denied = personalRefusal(harness) ?? (await adminRefusal(ports, tx, caller, harness, at));
    if (denied !== null) return denied;
    const personId = caller.actor.personId;
    if (personId === null) return refused('not_permitted', { jdArea: harness.jdArea });
    const held = await tx.workflowDrafts.read.forHarness(harness.id);
    const context = recordContext(ports, caller, at);
    const record = async (events: readonly EventDraft[]) => {
      await recordHarnessEvents(tx, context, harness.id, events);
    };
    return work({ tx, harness, at, personId, held, record });
  });
}

export function heldByCaller(scope: DraftScope): HeldDraft | KernelOutcome<never> {
  if (scope.held === null) return refused('draft_not_found', { harnessId: scope.harness.id });
  if (scope.held.holderPersonId !== scope.personId)
    return refused('draft_locked', { holder: scope.held.holderPersonId });
  return scope.held;
}

export function isOutcome<T>(value: HeldDraft | KernelOutcome<T>): value is KernelOutcome<T> {
  return 'status' in value;
}

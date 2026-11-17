import type { DraftStage, Harness, Stage } from '@uw/contracts';
import type { Caller } from '../../caller.ts';
import { draft } from '../../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../../outcome.ts';
import { instructionsRefusal } from '../guards.ts';
import type { HeldDraft, StoreTransaction, WorkflowDraftRow } from '../../store-ports.ts';
import { heldByCaller, isOutcome, withDraft, type DraftPorts, type DraftScope } from './access.ts';
import { draftOf, lockActive } from './shape.ts';

export type DraftInput = { readonly harnessId: string };
export type SaveInput = DraftInput & {
  readonly revision: number;
  readonly stages: readonly DraftStage[];
};
export type TakeOverInput = DraftInput & { readonly reason: string };

function rowOf(held: HeldDraft): WorkflowDraftRow {
  return {
    harnessId: held.harnessId,
    holderPersonId: held.holderPersonId,
    startedAt: held.startedAt,
    touchedAt: held.touchedAt,
    revision: held.revision,
    stages: held.stages,
    base: held.base,
  };
}

async function passTo(
  scope: DraftScope,
  held: HeldDraft,
  reason: string | null,
): Promise<KernelOutcome<WorkflowDraftRow>> {
  const row = {
    ...rowOf(held),
    holderPersonId: scope.personId,
    startedAt: scope.at,
    touchedAt: scope.at,
  };
  await scope.tx.workflowDrafts.write.put(row);
  await scope.record([
    draft('workflow_draft_taken_over', { fromPersonId: held.holderPersonId, reason }),
  ]);
  return accepted(row);
}

async function startFresh(scope: DraftScope): Promise<KernelOutcome<WorkflowDraftRow>> {
  const live = await scope.tx.harnessStages.read.forHarness(scope.harness.id);
  const row: WorkflowDraftRow = {
    harnessId: scope.harness.id,
    holderPersonId: scope.personId,
    startedAt: scope.at,
    touchedAt: scope.at,
    revision: 1,
    stages: draftOf(live),
    base: live,
  };
  await scope.tx.workflowDrafts.write.put(row);
  await scope.record([draft('workflow_draft_opened', {})]);
  return accepted(row);
}

async function open(scope: DraftScope): Promise<KernelOutcome<WorkflowDraftRow>> {
  const { held } = scope;
  if (held === null) return startFresh(scope);
  if (held.holderPersonId === scope.personId) {
    const row = { ...rowOf(held), touchedAt: scope.at };
    await scope.tx.workflowDrafts.write.put(row);
    return accepted(row);
  }
  if (lockActive(held.touchedAt, scope.at))
    return refused('draft_locked', { holder: held.holderPersonId });
  return passTo(scope, held, null);
}

function knownIds(base: readonly Stage[], stages: readonly DraftStage[]): boolean {
  const keys = new Map(base.map((stage) => [stage.id, stage.key]));
  const ids = stages.flatMap((stage) => (stage.id === null ? [] : [stage.id]));
  return (
    new Set(ids).size === ids.length &&
    stages.every((stage) => stage.id === null || keys.get(stage.id) === stage.key)
  );
}

export async function pagesRefusal(
  tx: StoreTransaction,
  harness: Harness,
  base: readonly Stage[],
  stages: readonly DraftStage[],
): Promise<KernelOutcome<never> | null> {
  const named = new Map(base.map((stage) => [stage.id, stage.instructionsPageId]));
  for (const stage of stages) {
    const page = stage.instructionsPageId;
    if (page === null || named.get(stage.id ?? '') === page) continue;
    const refusal = await instructionsRefusal(tx, harness, page);
    if (refusal !== null) return refusal;
  }
  return null;
}

async function save(scope: DraftScope, input: SaveInput): Promise<KernelOutcome<WorkflowDraftRow>> {
  const held = heldByCaller(scope);
  if (isOutcome(held)) return held;
  if (held.revision !== input.revision)
    return refused('draft_revision_mismatch', { revision: held.revision });
  if (!knownIds(held.base, input.stages))
    return refused('malformed_command', { why: 'stage_id_or_key_changed' });
  const pages = await pagesRefusal(scope.tx, scope.harness, held.base, input.stages);
  if (pages !== null) return pages;
  const row = {
    ...rowOf(held),
    stages: input.stages,
    revision: held.revision + 1,
    touchedAt: scope.at,
  };
  await scope.tx.workflowDrafts.write.put(row);
  await scope.record([draft('workflow_draft_saved', { revision: row.revision })]);
  return accepted(row);
}

async function takeOver(
  scope: DraftScope,
  reason: string,
): Promise<KernelOutcome<WorkflowDraftRow>> {
  const { held } = scope;
  if (held === null) return refused('draft_not_found', { harnessId: scope.harness.id });
  if (held.holderPersonId === scope.personId) return open(scope);
  return passTo(scope, held, reason.trim());
}

async function discard(scope: DraftScope): Promise<KernelOutcome<null>> {
  const { held } = scope;
  if (held === null) return refused('draft_not_found', { harnessId: scope.harness.id });
  if (held.holderPersonId !== scope.personId && lockActive(held.touchedAt, scope.at))
    return refused('draft_locked', { holder: held.holderPersonId });
  await scope.tx.workflowDrafts.write.remove(held.harnessId);
  await scope.record([draft('workflow_draft_discarded', {})]);
  return accepted(null);
}

export function lockCommands(ports: DraftPorts) {
  return {
    open: (caller: Caller, input: DraftInput) => withDraft(ports, caller, input.harnessId, open),
    save: (caller: Caller, input: SaveInput) =>
      withDraft(ports, caller, input.harnessId, (scope) => save(scope, input)),
    takeOver: (caller: Caller, input: TakeOverInput) =>
      withDraft(ports, caller, input.harnessId, (scope) => takeOver(scope, input.reason)),
    discard: (caller: Caller, input: DraftInput) =>
      withDraft(ports, caller, input.harnessId, discard),
  };
}

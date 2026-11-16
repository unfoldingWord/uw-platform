import type { DraftStage, Stage } from '@uw/contracts';
import type { Caller } from '../../caller.ts';
import { draft } from '../../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../../outcome.ts';
import { storeRefusalOf } from '../../port-errors.ts';
import { editDrafts } from '../edit.ts';
import type { StoreTransaction } from '../../store-ports.ts';
import { heldByCaller, isOutcome, withDraft, type DraftPorts, type DraftScope } from './access.ts';
import { draftProblems } from './check.ts';
import { positionOf, sameStages } from './shape.ts';
import { pagesRefusal, type DraftInput } from './lock.ts';

export type PublishInput = DraftInput & { readonly revision: number };

function resultingStages(
  ports: DraftPorts,
  harnessId: string,
  live: readonly Stage[],
  stages: readonly DraftStage[],
): readonly Stage[] {
  const paused = new Map(live.map((stage) => [stage.id, stage.paused]));
  return stages.map((stage, index) => ({
    ...stage,
    id: stage.id ?? ports.ids.next(),
    harnessId,
    position: positionOf(index),
    paused: paused.get(stage.id ?? '') ?? false,
  }));
}

async function apply(
  tx: StoreTransaction,
  live: readonly Stage[],
  resulting: readonly Stage[],
): Promise<void> {
  const existing = new Set(live.map((stage) => stage.id));
  const kept = resulting.filter((stage) => existing.has(stage.id));
  const keptIds = new Set(kept.map((stage) => stage.id));
  for (const stage of live.filter((entry) => !keptIds.has(entry.id)))
    await tx.harnessStages.write.remove(stage.id);
  const harnessId = resulting[0]?.harnessId ?? live[0]?.harnessId ?? '';
  await tx.harnessStages.write.reposition(
    harnessId,
    kept.map((stage) => ({ id: stage.id, position: stage.position })),
  );
  for (const stage of kept) await tx.harnessStages.write.update(stage);
  for (const stage of resulting.filter((entry) => !existing.has(entry.id)))
    await tx.harnessStages.write.insert(stage);
}

function columns(stage: Stage): string {
  return JSON.stringify([
    stage.title,
    stage.bracket,
    stage.agentPickup,
    stage.exitGate,
    stage.connector,
    stage.wipLimit,
    stage.instructionsPageId,
    stage.validators,
    stage.feeds,
  ]);
}

function differs(before: Stage | undefined, after: Stage): boolean {
  return before !== undefined && columns(before) !== columns(after);
}

function summaryOf(live: readonly Stage[], resulting: readonly Stage[]) {
  const before = new Map(live.map((stage) => [stage.id, stage]));
  const after = new Set(resulting.map((stage) => stage.id));
  const order = (stages: readonly Stage[]) =>
    stages
      .filter((stage) => before.has(stage.id) && after.has(stage.id))
      .map((stage) => stage.id)
      .join();
  return {
    added: resulting.filter((stage) => !before.has(stage.id)).map((stage) => stage.key),
    removed: live.filter((stage) => !after.has(stage.id)).map((stage) => stage.key),
    changed: resulting.filter((stage) => differs(before.get(stage.id), stage)).map((s) => s.key),
    reordered: order([...live].sort((a, b) => a.position - b.position)) !== order(resulting),
  };
}

async function publish(
  ports: DraftPorts,
  scope: DraftScope,
  input: PublishInput,
): Promise<KernelOutcome<readonly Stage[]>> {
  const held = heldByCaller(scope);
  if (isOutcome(held)) return held;
  if (held.revision !== input.revision)
    return refused('draft_revision_mismatch', { revision: held.revision });
  const live = await scope.tx.harnessStages.read.forHarness(scope.harness.id);
  if (!sameStages(held.base, live)) return refused('draft_stale', { harnessId: scope.harness.id });
  const pages = await pagesRefusal(scope.tx, scope.harness, live, held.stages);
  if (pages !== null) return pages;
  const problems = await draftProblems(scope.tx, scope.harness, live, held.stages);
  if (problems.length > 0) return refused('draft_has_problems', { problems: problems.length });
  const resulting = resultingStages(ports, scope.harness.id, live, held.stages);
  await apply(scope.tx, live, resulting);
  await scope.record([
    ...editDrafts(live, resulting),
    draft('workflow_published', summaryOf(live, resulting)),
  ]);
  await scope.tx.workflowDrafts.write.remove(scope.harness.id);
  return accepted(resulting);
}

export async function publishDraft(
  ports: DraftPorts,
  caller: Caller,
  input: PublishInput,
): Promise<KernelOutcome<readonly Stage[]>> {
  try {
    return await withDraft(ports, caller, input.harnessId, (scope) => publish(ports, scope, input));
  } catch (error) {
    const refusal = storeRefusalOf(error);
    if (refusal === null) throw error;
    return refused('stage_edit_refused', { code: refusal.code, constraint: refusal.constraint });
  }
}

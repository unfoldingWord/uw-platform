import type { DraftStage, Stage, StageRules } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { refused, accepted, type KernelOutcome } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import { withDraft, type DraftPorts, type DraftScope } from './drafts/access.ts';
import { draftProblems } from './drafts/check.ts';
import { pagesRefusal } from './drafts/lock.ts';
import { applyStages, resultingStages } from './drafts/publish.ts';
import { draftOf } from './drafts/shape.ts';
import { editDrafts } from './edit.ts';

export type StageRulesInput = {
  readonly harnessId: string;
  readonly stages: readonly StageRules[];
};

function withRules(
  live: readonly Stage[],
  rules: readonly StageRules[],
): readonly DraftStage[] | null {
  const ids = new Set(live.map((stage) => stage.id));
  if (!rules.every((rule) => ids.has(rule.id))) return null;
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return draftOf(live).map((stage) => {
    const rule = byId.get(stage.id ?? '');
    if (rule === undefined) return stage;
    return {
      ...stage,
      agentPickup: rule.agentPickup,
      exitGate: rule.exitGate,
      wipLimit: rule.wipLimit,
      instructionsPageId: rule.instructionsPageId,
      validators: [...rule.validators],
    };
  });
}

async function setRules(
  ports: DraftPorts,
  scope: DraftScope,
  input: StageRulesInput,
): Promise<KernelOutcome<readonly Stage[]>> {
  if (scope.held !== null) return refused('draft_locked', { holder: scope.held.holderPersonId });
  const live = await scope.tx.harnessStages.read.forHarness(scope.harness.id);
  const next = withRules(live, input.stages);
  if (next === null) return refused('malformed_command', { why: 'stage_not_in_workflow' });
  const pages = await pagesRefusal(scope.tx, scope.harness, live, next);
  if (pages !== null) return pages;
  const problems = await draftProblems(scope.tx, scope.harness, live, next);
  if (problems.length > 0)
    return refused('stage_rules_have_problems', {
      problems: problems.map((problem) => problem.message),
    });
  const resulting = resultingStages(ports, scope.harness.id, live, next);
  await applyStages(scope.tx, live, resulting);
  await scope.record(editDrafts(live, resulting));
  return accepted(resulting);
}

export async function setStageRules(
  ports: DraftPorts,
  caller: Caller,
  input: StageRulesInput,
): Promise<KernelOutcome<readonly Stage[]>> {
  try {
    return await withDraft(ports, caller, input.harnessId, (scope) =>
      setRules(ports, scope, input),
    );
  } catch (error) {
    const refusal = storeRefusalOf(error);
    if (refusal === null) throw error;
    return refused('stage_edit_refused', { code: refusal.code, constraint: refusal.constraint });
  }
}

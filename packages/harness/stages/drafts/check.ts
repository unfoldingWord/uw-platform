import type { DraftProblem, DraftProblemCode, DraftStage, Harness, Stage } from '@uw/contracts';
import { connectorRegistered, connectorRegistry } from '../../connectors/registry.ts';
import type { EffectConnector, StoreTransaction } from '../../ports.ts';
import { connectorInFlight, removalRefusal } from '../guards.ts';
import { templateProperty } from '../../template-property.ts';
import { validatorRegistry } from '../../validators/registry.ts';
import { positionOf } from './shape.ts';

const problem = (stage: string | null, code: DraftProblemCode, message: string): DraftProblem => ({
  stage,
  code,
  message,
});

function named(stage: DraftStage): string {
  return stage.title.trim() === '' ? stage.key : stage.title.trim();
}

function columnProblems(stage: DraftStage, keys: ReadonlySet<string>): DraftProblem[] {
  const found: DraftProblem[] = [];
  const at = (code: DraftProblemCode, message: string) =>
    found.push(problem(stage.key, code, message));
  if (stage.title.trim() === '') at('title_blank', `Stage ${stage.key} needs a title.`);
  if (stage.wipLimit < 1) at('wip_limit_low', `${named(stage)} needs room for at least 1 item.`);
  for (const target of stage.feeds.filter((feed) => !keys.has(feed)))
    at(
      'unknown_loop_target',
      `${named(stage)} loops back to ${target}, which is not in the workflow.`,
    );
  for (const validator of stage.validators.filter((key) => !validatorRegistry.has(key)))
    at(
      'unknown_validator',
      `${named(stage)} names a check the platform does not know: ${validator}.`,
    );
  return found;
}

function effectProblems(stage: DraftStage, registry: ReadonlySet<EffectConnector>): DraftProblem[] {
  if (!connectorRegistered(stage.connector, registry))
    return [
      problem(
        stage.key,
        'connector_not_registered',
        `${named(stage)} uses an action the platform cannot run: ${stage.connector}.`,
      ),
    ];
  if (stage.connector === 'none' || stage.exitGate === 'human_approval') return [];
  return [
    problem(
      stage.key,
      'connector_needs_person',
      `${named(stage)} runs ${stage.connector}, so a person must approve before it leaves the stage.`,
    ),
  ];
}

function repeatedKeys(stages: readonly DraftStage[]): DraftProblem[] {
  const seen = new Set<string>();
  return stages.flatMap((stage) => {
    if (!seen.has(stage.key)) {
      seen.add(stage.key);
      return [];
    }
    return [problem(stage.key, 'key_repeated', `Two stages share the key ${stage.key}.`)];
  });
}

function pathProblems(stages: readonly DraftStage[], flagged: ReadonlySet<string>): DraftProblem[] {
  const walkable = stages.map((stage, index) => ({ ...stage, position: positionOf(index) }));
  return templateProperty(walkable)
    .filter((violation) => !flagged.has(violation.effectStage))
    .map((violation) =>
      problem(
        violation.effectStage,
        'bypasses_person',
        `The path ${violation.path.join(' → ')} reaches ${violation.effectStage} without a person approving first.`,
      ),
    );
}

export function shapeProblems(
  stages: readonly DraftStage[],
  registry: ReadonlySet<EffectConnector> = connectorRegistry,
): readonly DraftProblem[] {
  if (stages.length === 0)
    return [problem(null, 'no_stages', 'A workflow needs at least one stage.')];
  const keys = new Set(stages.map((stage) => stage.key));
  const found = [
    ...repeatedKeys(stages),
    ...stages.flatMap((stage) => [
      ...columnProblems(stage, keys),
      ...effectProblems(stage, registry),
    ]),
  ];
  const walkBlocked = found.some(
    (entry) => entry.code === 'key_repeated' || entry.code === 'unknown_loop_target',
  );
  if (walkBlocked) return found;
  const flagged = new Set(
    found
      .filter((entry) => entry.code === 'connector_needs_person')
      .map((entry) => entry.stage ?? ''),
  );
  return [...found, ...pathProblems(stages, flagged)];
}

function removalProblem(stage: Stage, reason: string, why: unknown): DraftProblem {
  if (reason === 'not_permitted')
    return problem(
      stage.key,
      'effect_stage_removed',
      `${stage.title} runs ${stage.connector}, so it cannot be removed.`,
    );
  if (why === 'stage_has_history')
    return problem(
      stage.key,
      'stage_has_history',
      `${stage.title} has gate decisions on record, so it cannot be removed.`,
    );
  return problem(
    stage.key,
    'stage_holds_items',
    `${stage.title} still holds items, so it cannot be removed.`,
  );
}

async function removedProblems(
  tx: StoreTransaction,
  harness: Harness,
  live: readonly Stage[],
  kept: ReadonlySet<string>,
): Promise<DraftProblem[]> {
  const found: DraftProblem[] = [];
  for (const stage of live.filter((entry) => !kept.has(entry.id))) {
    const refusal = await removalRefusal(tx, harness, stage);
    if (refusal !== null) found.push(removalProblem(stage, refusal.reason, refusal.detail['why']));
  }
  return found;
}

async function connectorProblems(
  tx: StoreTransaction,
  harness: Harness,
  live: readonly Stage[],
  stages: readonly DraftStage[],
): Promise<DraftProblem[]> {
  const byId = new Map(live.map((stage) => [stage.id, stage]));
  const found: DraftProblem[] = [];
  for (const stage of stages) {
    const before = stage.id === null ? undefined : byId.get(stage.id);
    if (before === undefined || before.connector === stage.connector) continue;
    if ((await connectorInFlight(tx, harness, before)) !== null)
      found.push(
        problem(
          stage.key,
          'decision_in_flight',
          `${named(stage)} has an approval waiting on its current action, so its action cannot change yet.`,
        ),
      );
  }
  return found;
}

export async function draftProblems(
  tx: StoreTransaction,
  harness: Harness,
  live: readonly Stage[],
  stages: readonly DraftStage[],
): Promise<readonly DraftProblem[]> {
  const kept = new Set(stages.flatMap((stage) => (stage.id === null ? [] : [stage.id])));
  return [
    ...shapeProblems(stages),
    ...(await removedProblems(tx, harness, live, kept)),
    ...(await connectorProblems(tx, harness, live, stages)),
  ];
}

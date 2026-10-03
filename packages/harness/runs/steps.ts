import type { ItemState, RunStepRecord } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, type EventDraft, type RecordContext } from '../items/record.ts';
import { refused, type Refused } from '../outcome.ts';
import type { RunRow, StoreTransaction } from '../ports.ts';
import { newExternalRun, withStep } from './rows.ts';
import type { RunStepInput } from './types.ts';

const STEP_LIMIT = 200;

type StepScene = {
  readonly caller: Caller;
  readonly item: ItemState;
  readonly input: RunStepInput;
};

type StepRecorded = {
  readonly drafts: readonly EventDraft[];
  readonly prompts: readonly string[];
};

function costRefusal(input: RunStepInput): Refused | null {
  if (input.costBasis !== 'subscription') return null;
  if ((input.costMinor ?? null) === null && (input.computeMinor ?? null) === null) return null;
  return refused('malformed_command', { why: 'subscription_has_no_cost' });
}

function otherDelegation(run: RunRow, item: ItemState): boolean {
  return run.runShape === 'workflow-run' && run.delegationId !== item.delegationId;
}

function runRefusal(run: RunRow, { caller, item, input }: StepScene): Refused | null {
  const elsewhere =
    run.itemId !== item.itemId ||
    run.costBasis !== input.costBasis ||
    run.persona !== caller.actor.identity ||
    otherDelegation(run, item);
  if (elsewhere) return refused('not_permitted', { why: 'run_elsewhere' });
  if (run.outcome !== 'running') return refused('not_permitted', { why: `run_${run.outcome}` });
  if (run.steps.length >= STEP_LIMIT) return refused('not_permitted', { why: 'run_step_limit' });
  return null;
}

function recordOf(input: RunStepInput, at: Date): RunStepRecord {
  return {
    step: input.step,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costMinor: input.costMinor ?? null,
    computeMinor: input.computeMinor ?? null,
    model: input.model ?? null,
    resolvedProvider: input.resolvedProvider ?? null,
    toolsCalled: [...(input.toolsCalled ?? [])],
    writes: input.writes ?? 0,
    at: at.toISOString(),
  };
}

async function firstStep(
  tx: StoreTransaction,
  context: RecordContext,
  scene: StepScene,
): Promise<StepRecorded | Refused> {
  const { caller, item, input } = scene;
  if (input.costBasis === 'metered') return refused('run_not_found', { runId: input.runId });
  const live = await tx.harnessRuns.read.liveForItem(item.itemId);
  if (live !== null) return refused('not_permitted', { why: 'run_elsewhere' });
  const run = newExternalRun({
    runId: input.runId,
    item,
    persona: caller.actor.identity,
    model: input.model ?? null,
    traceId: context.traceId,
    at: context.at,
  });
  await tx.harnessRuns.write.insert(withStep(run, recordOf(input, context.at)));
  const started = draft('run_started', {
    runId: run.id,
    persona: run.persona,
    runShape: run.runShape,
    engine: run.engine,
    model: run.model,
    delegationId: run.delegationId,
  });
  return { drafts: [started], prompts: [] };
}

export async function recordStepIn(
  tx: StoreTransaction,
  context: RecordContext,
  scene: StepScene,
): Promise<StepRecorded | Refused> {
  const malformed = costRefusal(scene.input);
  if (malformed !== null) return malformed;
  const run = await tx.harnessRuns.read.lock(scene.input.runId);
  if (run === null) return firstStep(tx, context, scene);
  const denied = runRefusal(run, scene);
  if (denied !== null) return denied;
  await tx.harnessRuns.write.update(withStep(run, recordOf(scene.input, context.at)));
  return { drafts: [], prompts: run.prompts };
}

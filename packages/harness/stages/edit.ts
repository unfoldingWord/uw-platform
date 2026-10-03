import type { Harness, HarnessEvent, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { recordContext, recordHarnessEvents, draft, type EventDraft } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { adminRefusal, agentRefusal, bypassRefusal, stageProblems } from './rules.ts';

type StagePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

type EditPlan<T> = {
  readonly stageKey: string | null;
  readonly resulting: readonly Stage[];
  apply(tx: StoreTransaction): Promise<KernelOutcome<T>>;
};

export type EditWork<T> = (
  tx: StoreTransaction,
  harness: Harness,
  stages: readonly Stage[],
) => Promise<EditPlan<T> | Refused>;

async function authorize(
  ports: StagePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<Harness | Refused> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId });
  return (await adminRefusal(ports, tx, caller, harness, at)) ?? harness;
}

async function recordRefusal(
  ports: StagePorts,
  tx: StoreTransaction,
  context: { readonly caller: Caller; readonly at: Date; readonly harnessId: string },
  refusal: { readonly stage: string | null; readonly outcome: Refused },
): Promise<void> {
  const code = refusal.outcome.detail['code'] ?? null;
  const constraint = refusal.outcome.detail['constraint'] ?? null;
  await recordHarnessEvents(
    tx,
    recordContext(ports, context.caller, context.at),
    context.harnessId,
    [
      draft('stage_edit_refused', {
        stage: refusal.stage,
        reason: refusal.outcome.reason,
        code: typeof code === 'string' ? code : null,
        constraint: typeof constraint === 'string' ? constraint : null,
      }),
    ],
  );
}

type Columns = HarnessEvent['evidence'];

function columnsOf(stage: Stage): Columns {
  return {
    key: stage.key,
    title: stage.title,
    position: stage.position,
    bracket: stage.bracket,
    agentPickup: stage.agentPickup,
    exitGate: stage.exitGate,
    connector: stage.connector,
    wipLimit: stage.wipLimit,
    instructionsPageId: stage.instructionsPageId,
    validators: [...stage.validators],
    feeds: [...stage.feeds],
    paused: stage.paused,
  };
}

function changedColumns(before: Stage, after: Stage): { before: Columns; after: Columns } {
  const was = new Map(Object.entries(columnsOf(before)));
  const changed = Object.entries(columnsOf(after)).filter(
    ([column, value]) => JSON.stringify(was.get(column)) !== JSON.stringify(value),
  );
  return {
    before: Object.fromEntries(changed.map(([column]) => [column, was.get(column) ?? null])),
    after: Object.fromEntries(changed),
  };
}

function editDraft(previous: Stage | undefined, next: Stage): EventDraft | null {
  if (previous === undefined) {
    return draft('stage_edited', {
      stageId: next.id,
      key: next.key,
      before: null,
      after: columnsOf(next),
    });
  }
  const changed = changedColumns(previous, next);
  if (Object.keys(changed.after).length === 0) return null;
  return draft('stage_edited', { stageId: next.id, key: next.key, ...changed });
}

function editDrafts(before: readonly Stage[], after: readonly Stage[]): readonly EventDraft[] {
  const previous = new Map(before.map((stage) => [stage.id, stage]));
  const kept = new Set(after.map((stage) => stage.id));
  const removed = before
    .filter((stage) => !kept.has(stage.id))
    .map((stage) =>
      draft('stage_removed', { stageId: stage.id, key: stage.key, before: columnsOf(stage) }),
    );
  return [...after.flatMap((stage) => editDraft(previous.get(stage.id), stage) ?? []), ...removed];
}

function walkRefusal(stages: readonly Stage[]): Refused | null {
  const keys = new Set(stages.map((stage) => stage.key));
  return keys.size === stages.length ? bypassRefusal(stages) : null;
}

export async function editInTransaction<T>(
  ports: StagePorts,
  caller: Caller,
  harnessId: string,
  work: EditWork<T>,
): Promise<KernelOutcome<T>> {
  const at = ports.clock.now();
  let planned: string | null = null;
  try {
    return await ports.store.transaction(async (tx) => {
      await tx.lock(lockKeys.harnessStages(harnessId));
      const harness = await authorize(ports, tx, caller, harnessId, at);
      if ('status' in harness) return harness;
      const current = await tx.harnessStages.read.forHarness(harness.id);
      const plan = await work(tx, harness, current);
      if ('status' in plan) return plan;
      planned = plan.stageKey;
      const problem = stageProblems(plan.resulting) ?? walkRefusal(plan.resulting);
      if (problem === null) {
        const applied = await plan.apply(tx);
        if (applied.status !== 'accepted') return applied;
        const context = recordContext(ports, caller, at);
        await recordHarnessEvents(tx, context, harness.id, editDrafts(current, plan.resulting));
        return applied;
      }
      await recordRefusal(
        ports,
        tx,
        { caller, at, harnessId },
        { stage: plan.stageKey, outcome: problem },
      );
      return problem;
    });
  } catch (error) {
    const refusal = storeRefusalOf(error);
    if (refusal === null) throw error;
    const outcome = refused('stage_edit_refused', {
      code: refusal.code,
      constraint: refusal.constraint,
    });
    await ports.store.transaction((tx) =>
      recordRefusal(ports, tx, { caller, at, harnessId }, { stage: planned, outcome }),
    );
    return outcome;
  }
}

import type { Harness, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { recordContext, recordHarnessEvents, draft } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { agentRefusal, permissionRefusal, stageProblems } from './rules.ts';

type StagePorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

type EditPlan<T> = {
  readonly stageKey: string | null;
  readonly resulting: readonly Stage[];
  apply(tx: StoreTransaction): Promise<T>;
};

export type EditWork<T> = (harness: Harness, stages: readonly Stage[]) => EditPlan<T> | Refused;

async function authorize(
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<Harness | Refused> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId });
  return permissionRefusal(caller, harness, at) ?? harness;
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
      const harness = await authorize(tx, caller, harnessId, at);
      if ('status' in harness) return harness;
      const plan = work(harness, await tx.harnessStages.read.forHarness(harness.id));
      if ('status' in plan) return plan;
      planned = plan.stageKey;
      const problem = stageProblems(plan.resulting);
      if (problem === null) return accepted(await plan.apply(tx));
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

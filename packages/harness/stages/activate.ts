import type { Harness, JdArea, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { Ports } from '../ports.ts';
import { describeViolation, templateProperty } from '../template-property.ts';
import type { Template } from '../templates/types.ts';
import { adminRefusal, agentRefusal, stageFromTemplate, stageProblems } from './rules.ts';

type StagePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ActivateInput = {
  readonly harnessId: string;
  readonly harnessKey: string;
  readonly jdArea: JdArea;
  readonly template: Template;
};

export type Activated = { readonly harness: Harness; readonly stages: readonly Stage[] };

function templateRefusal(stages: readonly Stage[]): Refused | null {
  const problem = stageProblems(stages);
  if (problem !== null) return problem;
  const violation = templateProperty(stages)[0];
  if (violation === undefined) return null;
  return refused('template_bypasses_gate', {
    path: violation.path,
    effectStage: violation.effectStage,
    message: describeViolation(violation),
  });
}

async function insertAll(
  ports: StagePorts,
  caller: Caller,
  at: Date,
  activated: Activated,
  template: Template,
): Promise<KernelOutcome<Activated>> {
  return ports.store.transaction(async (tx) => {
    const { harness, stages } = activated;
    await tx.lock(lockKeys.harnessStages(harness.id));
    const denied = await adminRefusal(ports, tx, caller, harness, at);
    if (denied !== null) return denied;
    const taken =
      (await tx.harnesses.read.byId(harness.id)) ?? (await tx.harnesses.read.byKey(harness.key));
    if (taken !== null) return refused('harness_exists', { harnessKey: harness.key });
    await tx.harnesses.write.insert(harness, at);
    for (const stage of stages) await tx.harnessStages.write.insert(stage);
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('template_activated', {
        template: template.key,
        stages: [...stages].sort((a, b) => a.position - b.position).map((stage) => stage.key),
      }),
    ]);
    return accepted(activated);
  });
}

export async function activateTemplate(
  ports: StagePorts,
  caller: Caller,
  input: ActivateInput,
): Promise<KernelOutcome<Activated>> {
  const at = ports.clock.now();
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const harness: Harness = {
    id: input.harnessId,
    key: input.harnessKey,
    template: input.template.key,
    jdArea: input.jdArea,
    hostedBuilderEnabled: false,
    paused: false,
  };
  const stages = input.template.stages.map((stage) =>
    stageFromTemplate(stage, harness.id, ports.ids.next()),
  );
  const refusal = templateRefusal(stages);
  if (refusal !== null) return refusal;
  try {
    return await insertAll(ports, caller, at, { harness, stages }, input.template);
  } catch (error) {
    const store = storeRefusalOf(error);
    if (store === null) throw error;
    if (store.constraint === 'harnesses_key_unique') {
      return refused('harness_exists', { harnessKey: input.harnessKey });
    }
    return refused('stage_edit_refused', { code: store.code, constraint: store.constraint });
  }
}

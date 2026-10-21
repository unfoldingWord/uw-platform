import type { Harness, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { templates } from '../templates.ts';
import type { Template } from '../templates/types.ts';
import { editInTransaction, type EditWork } from './edit.ts';
import { bypassRefusal, stageFromTemplate } from './rules.ts';

type ChangePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ChangeTemplateInput = { readonly harnessId: string; readonly template: string };

type Change = { readonly kept: readonly Stage[]; readonly added: readonly Stage[] };
type Applying = {
  readonly harness: Harness;
  readonly target: Template;
  readonly change: Change;
  readonly context: RecordContext;
};

const allowed: ReadonlyMap<string, string> = new Map([['check-only', 'software']]);

function notAllowed(harness: Harness, to: string, why: string): Refused {
  return refused('template_change_not_allowed', { from: harness.template, to, why });
}

function planChange(
  ports: Pick<Ports, 'ids'>,
  harness: Harness,
  current: readonly Stage[],
  target: Template,
): Change | Refused {
  if (allowed.get(harness.template) !== target.key) {
    return notAllowed(harness, target.key, 'only_check_only_to_software');
  }
  const positions = new Map(target.stages.map((stage) => [stage.key, stage.position]));
  if (current.length === 0 || current.some((stage) => !positions.has(stage.key))) {
    return notAllowed(harness, target.key, 'stages_edited');
  }
  const kept = current.map((stage) => ({
    ...stage,
    position: positions.get(stage.key) ?? stage.position,
  }));
  const have = new Set(current.map((stage) => stage.key));
  const added = target.stages
    .filter((stage) => !have.has(stage.key))
    .map((stage) => stageFromTemplate(stage, harness.id, ports.ids.next()));
  return { kept, added };
}

async function applyChange(
  tx: StoreTransaction,
  applying: Applying,
): Promise<KernelOutcome<HarnessScene>> {
  const { harness, target, change } = applying;
  if (!(await tx.harnesses.write.setTemplate(harness.id, harness.template, target.key))) {
    return refused('stale_version', { harnessId: harness.id });
  }
  const positions = change.kept.map((stage) => ({ id: stage.id, position: stage.position }));
  await tx.harnessStages.write.reposition(harness.id, positions);
  for (const stage of change.added) await tx.harnessStages.write.insert(stage);
  await recordHarnessEvents(tx, applying.context, harness.id, [
    draft('template_changed', {
      from: harness.template,
      to: target.key,
      kept: change.kept.map((stage) => stage.key),
      added: change.added.map((stage) => stage.key),
    }),
  ]);
  const stages = [...change.kept, ...change.added].sort((a, b) => a.position - b.position);
  return accepted({ harness: { ...harness, template: target.key }, stages });
}

export function changeTemplate(
  ports: ChangePorts,
  caller: Caller,
  input: ChangeTemplateInput,
): Promise<KernelOutcome<HarnessScene>> {
  const target = templates.get(input.template);
  if (target === undefined) {
    return Promise.resolve(refused('malformed_command', { template: input.template }));
  }
  const context = recordContext(ports, caller, ports.clock.now());
  const work: EditWork<HarnessScene> = async (_tx, harness, current) => {
    const change = planChange(ports, harness, current, target);
    if ('status' in change) return change;
    const resulting = [...change.kept, ...change.added];
    const bypass = bypassRefusal(resulting);
    if (bypass !== null) return bypass;
    return {
      stageKey: null,
      resulting,
      apply: (tx) => applyChange(tx, { harness, target, change, context }),
    };
  };
  return editInTransaction(ports, caller, input.harnessId, work);
}

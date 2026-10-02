import { stageSchema, type Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { activateTemplate, type Activated, type ActivateInput } from './activate.ts';
import { editInTransaction, type EditWork } from './edit.ts';

type StagePorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

export type StageInput = Omit<Stage, 'id' | 'harnessId' | 'paused'>;
export type StageChange = Partial<Omit<Stage, 'id' | 'harnessId' | 'key'>>;

export type StageCommands = {
  activate(caller: Caller, input: ActivateInput): Promise<KernelOutcome<Activated>>;
  createStage(
    caller: Caller,
    input: { readonly harnessId: string; readonly stage: StageInput },
  ): Promise<KernelOutcome<Stage>>;
  updateStage(
    caller: Caller,
    input: {
      readonly harnessId: string;
      readonly stageKey: string;
      readonly change: StageChange;
    },
  ): Promise<KernelOutcome<Stage>>;
  reorderStages(
    caller: Caller,
    input: { readonly harnessId: string; readonly order: readonly string[] },
  ): Promise<KernelOutcome<readonly Stage[]>>;
};

function replaceOne(stages: readonly Stage[], next: Stage): readonly Stage[] {
  return stages.map((stage) => (stage.key === next.key ? next : stage));
}

function createWork(ports: StagePorts, stage: StageInput): EditWork<Stage> {
  return (harness, stages) => {
    const created: Stage = { ...stage, id: ports.ids.next(), harnessId: harness.id, paused: false };
    if (!stageSchema.safeParse(created).success) {
      return refused('malformed_command', { stage: stage.key });
    }
    return {
      stageKey: created.key,
      resulting: [...stages, created],
      apply: async (tx) => {
        await tx.harnessStages.write.insert(created);
        return created;
      },
    };
  };
}

function updateWork(stageKey: string, change: StageChange): EditWork<Stage> {
  return (_harness, stages) => {
    const current = stages.find((stage) => stage.key === stageKey);
    if (current === undefined) return refused('stage_not_found', { stage: stageKey });
    const next: Stage = { ...current, ...change };
    if (!stageSchema.safeParse(next).success) {
      return refused('malformed_command', { stage: stageKey });
    }
    return {
      stageKey,
      resulting: replaceOne(stages, next),
      apply: async (tx) => {
        await tx.harnessStages.write.update(next);
        return next;
      },
    };
  };
}

function reorderWork(order: readonly string[]): EditWork<readonly Stage[]> {
  return (harness, stages) => {
    const known = new Set(stages.map((stage) => stage.key));
    const unknown = order.find((key) => !known.has(key));
    if (unknown !== undefined) return refused('stage_not_found', { stage: unknown });
    if (order.length !== known.size || new Set(order).size !== known.size) {
      return refused('malformed_command', { stages: order });
    }
    const positions = new Map(order.map((key, index) => [key, (index + 1) * 10]));
    const moved = stages.map((stage) => ({ ...stage, position: positions.get(stage.key) ?? 0 }));
    return {
      stageKey: null,
      resulting: moved,
      apply: async (tx) => {
        await tx.harnessStages.write.reposition(
          harness.id,
          moved.map((stage) => ({ id: stage.id, position: stage.position })),
        );
        return [...moved].sort((a, b) => a.position - b.position);
      },
    };
  };
}

export function createStageCommands(ports: StagePorts): StageCommands {
  return {
    activate: (caller, input) => activateTemplate(ports, caller, input),
    createStage: (caller, input) =>
      editInTransaction(ports, caller, input.harnessId, createWork(ports, input.stage)),
    updateStage: (caller, input) =>
      editInTransaction(ports, caller, input.harnessId, updateWork(input.stageKey, input.change)),
    reorderStages: (caller, input) =>
      editInTransaction(ports, caller, input.harnessId, reorderWork(input.order)),
  };
}

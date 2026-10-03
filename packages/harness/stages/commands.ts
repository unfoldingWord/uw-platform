import { stageSchema, type Harness, type ItemState, type Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { approvalsAwaitingOutcome } from '../gates/parking.ts';
import { readAllEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StageCursor, StoreTransaction } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { activateTemplate, type Activated, type ActivateInput } from './activate.ts';
import { editInTransaction, type EditWork } from './edit.ts';
import { setHostedBuilder, type HostedBuilderInput } from './hosted-builder.ts';
import { setPause, type PauseInput } from './pause.ts';

type StagePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'runs'>;

export type StageInput = Omit<Stage, 'id' | 'harnessId' | 'paused'>;
type StageColumns = Omit<Stage, 'id' | 'harnessId' | 'key' | 'paused'>;
export type StageChange = {
  readonly [Column in keyof StageColumns]?: StageColumns[Column] | undefined;
};

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
  removeStage(
    caller: Caller,
    input: { readonly harnessId: string; readonly stageKey: string },
  ): Promise<KernelOutcome<readonly Stage[]>>;
  pause(caller: Caller, input: PauseInput): Promise<KernelOutcome<HarnessScene>>;
  resume(caller: Caller, input: PauseInput): Promise<KernelOutcome<HarnessScene>>;
  setHostedBuilder(caller: Caller, input: HostedBuilderInput): Promise<KernelOutcome<HarnessScene>>;
};

const stageChangeSchema = stageSchema
  .omit({ id: true, harnessId: true, key: true, paused: true })
  .partial()
  .strict();

function replaceOne(stages: readonly Stage[], next: Stage): readonly Stage[] {
  return stages.map((stage) => (stage.key === next.key ? next : stage));
}

async function instructionsRefusal(
  tx: StoreTransaction,
  harness: Harness,
  pageId: string | null | undefined,
): Promise<Refused | null> {
  if (pageId === null || pageId === undefined) return null;
  const [page] = await tx.pages.read.facts([pageId]);
  const usable = page !== undefined && page.type !== 'issue' && page.jdArea === harness.jdArea;
  return usable ? null : refused('page_not_found', { pageId });
}

function createWork(ports: StagePorts, stage: StageInput): EditWork<Stage> {
  return async (tx, harness, stages) => {
    const created: Stage = { ...stage, id: ports.ids.next(), harnessId: harness.id, paused: false };
    if (!stageSchema.safeParse(created).success) {
      return refused('malformed_command', { stage: stage.key });
    }
    const page = await instructionsRefusal(tx, harness, created.instructionsPageId);
    if (page !== null) return page;
    return {
      stageKey: created.key,
      resulting: [...stages, created],
      apply: async (tx) => {
        await tx.harnessStages.write.insert(created);
        return accepted(created);
      },
    };
  };
}

const inFlightPage = 50;

async function awaitingOutcome(
  tx: StoreTransaction,
  harness: Harness,
  items: readonly ItemState[],
): Promise<ItemState | null> {
  for (const item of items) {
    const events = await readAllEvents(tx, harness.id, item.itemId);
    if (approvalsAwaitingOutcome(events).length > 0) return item;
  }
  return null;
}

async function connectorInFlight(
  tx: StoreTransaction,
  harness: Harness,
  stage: Stage,
): Promise<Refused | null> {
  await tx.lock(lockKeys.stageClaims(stage.id));
  for (let after: StageCursor | null = null; ;) {
    const page = await tx.harnessItems.read.openInStage(harness.id, stage.key, {
      after,
      limit: inFlightPage,
    });
    const waiting = await awaitingOutcome(tx, harness, page);
    if (waiting !== null) {
      return refused('decision_in_flight', { stage: stage.key, itemId: waiting.itemId });
    }
    const last = page.at(-1);
    if (page.length < inFlightPage || last === undefined) return null;
    after = { priority: last.priority, itemId: last.itemId };
  }
}

function updateWork(stageKey: string, change: StageChange): EditWork<Stage> {
  return async (tx, harness, stages) => {
    const current = stages.find((stage) => stage.key === stageKey);
    if (current === undefined) return refused('stage_not_found', { stage: stageKey });
    const parsed = stageChangeSchema.safeParse(change);
    if (!parsed.success) return refused('malformed_command', { stage: stageKey });
    const next: Stage = Object.assign({}, current, parsed.data);
    if (!stageSchema.safeParse(next).success) {
      return refused('malformed_command', { stage: stageKey });
    }
    const page = await instructionsRefusal(tx, harness, parsed.data.instructionsPageId);
    if (page !== null) return page;
    if (next.connector !== current.connector) {
      const inFlight = await connectorInFlight(tx, harness, current);
      if (inFlight !== null) return inFlight;
    }
    return {
      stageKey,
      resulting: replaceOne(stages, next),
      apply: async (write) =>
        (await write.harnessStages.write.update(next))
          ? accepted(next)
          : refused('stage_not_found', { stage: stageKey }),
    };
  };
}

async function removalRefusal(
  tx: StoreTransaction,
  harness: Harness,
  stage: Stage,
): Promise<Refused | null> {
  if (stage.connector !== 'none') {
    return refused('not_permitted', { stage: stage.key, why: 'effect_stage' });
  }
  const items = await tx.harnessItems.read.forHarness(harness.id);
  if (items.some((item) => item.stageKey === stage.key)) {
    return refused('stage_not_empty', { stage: stage.key });
  }
  if (await tx.gateDecisions.read.anyForStage(stage.id)) {
    return refused('stage_not_empty', { stage: stage.key, why: 'stage_has_history' });
  }
  return null;
}

function byPosition(stages: readonly Stage[]): readonly Stage[] {
  return [...stages].sort((a, b) => a.position - b.position);
}

function removeWork(stageKey: string): EditWork<readonly Stage[]> {
  return async (tx, harness, stages) => {
    const stage = stages.find((entry) => entry.key === stageKey);
    if (stage === undefined) return refused('stage_not_found', { stage: stageKey });
    const refusal = await removalRefusal(tx, harness, stage);
    if (refusal !== null) return refusal;
    const resulting = stages.filter((entry) => entry.id !== stage.id);
    return {
      stageKey,
      resulting,
      apply: async (write) =>
        (await write.harnessStages.write.remove(stage.id))
          ? accepted(byPosition(resulting))
          : refused('stage_not_found', { stage: stageKey }),
    };
  };
}

function reorderWork(order: readonly string[]): EditWork<readonly Stage[]> {
  return async (_tx, harness, stages) => {
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
        return accepted(byPosition(moved));
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
    removeStage: (caller, input) =>
      editInTransaction(ports, caller, input.harnessId, removeWork(input.stageKey)),
    pause: (caller, input) => setPause(ports, caller, input, true),
    resume: (caller, input) => setPause(ports, caller, input, false),
    setHostedBuilder: (caller, input) => setHostedBuilder(ports, caller, input),
  };
}

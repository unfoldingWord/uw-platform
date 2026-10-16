import type { ItemState, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { RunRow, StoreTransaction } from '../ports.ts';
import { harnessScene, stagePageLimit, type ScenePorts } from '../reads/scene.ts';
import { basesOf, costOf, hostOf } from './costs.ts';
import { epicBoard } from './epics.ts';
import { byPosition } from './flow.ts';
import { holderOf, reviewingIds } from './holder.ts';
import type { BoardCard, BoardColumn, BoardInput, BoardView } from './types.ts';

const liveOutcomes: ReadonlySet<RunRow['outcome']> = new Set(['running', 'hibernated']);

type Listed = {
  readonly stage: Stage;
  readonly held: number;
  readonly items: readonly ItemState[];
};

function leaseOf(item: ItemState): Date | null {
  if (item.holder === null || item.leaseExpiresAt === null) return null;
  return item.holder.startsWith('agent:') ? new Date(item.leaseExpiresAt) : null;
}

function cardOf(item: ItemState, runs: readonly RunRow[], holder: BoardCard['holder']): BoardCard {
  const own = runs.filter((run) => run.itemId === item.itemId);
  const liveRun = own.find((run) => liveOutcomes.has(run.outcome)) ?? null;
  return {
    item,
    host: hostOf(item, liveRun),
    leaseExpiresAt: leaseOf(item),
    bases: basesOf(own),
    cost: costOf(own),
    liveRun,
    holder,
  };
}

function nextOf(items: readonly ItemState[]): string | null {
  const last = items.at(-1);
  if (items.length < stagePageLimit || last === undefined) return null;
  return `${last.priority}.${last.itemId}`;
}

type Marks = { readonly reviewing: ReadonlySet<string> };

function columnOf(listed: Listed, runs: readonly RunRow[], marks: Marks): BoardColumn {
  const holder = (item: ItemState) =>
    holderOf(item, listed.stage, marks.reviewing.has(item.itemId));
  return {
    stage: listed.stage,
    held: listed.held,
    cards: listed.items.map((item) => cardOf(item, runs, holder(item))),
    next: nextOf(listed.items),
  };
}

function shownStages(stages: readonly Stage[], input: BoardInput): readonly Stage[] | null {
  if (input.stageKey === null) return input.after === null ? byPosition(stages) : null;
  const named = stages.find((stage) => stage.key === input.stageKey);
  return named === undefined ? null : [named];
}

export async function boardView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: BoardInput,
  at: Date,
): Promise<KernelOutcome<BoardView>> {
  const scene = await harnessScene(ports, tx, caller, input.harnessId, at);
  if (scene.status !== 'accepted') return scene;
  const { harness, stages } = scene.value;
  const shown = shownStages(stages, input);
  if (shown === null) return refused('stage_not_found', { stageKey: input.stageKey });
  const listed: Listed[] = [];
  for (const stage of shown) {
    const page = { after: input.after, limit: stagePageLimit };
    listed.push({
      stage,
      held: await tx.harnessItems.read.heldInStage(harness.id, stage.key, at),
      items: await tx.harnessItems.read.openInStage(harness.id, stage.key, page),
    });
  }
  const items = listed.flatMap((column) => column.items);
  const runs = await tx.harnessRuns.read.forItems(items.map((item) => item.itemId));
  const marks = { reviewing: await reviewingIds(tx, items) };
  const whole = input.stageKey === null && input.after === null;
  const extras = whole ? await epicBoard(tx, harness.id, stages, at) : { epics: [], notReady: [] };
  return accepted({
    harness,
    columns: listed.map((column) => columnOf(column, runs, marks)),
    ...extras,
  });
}

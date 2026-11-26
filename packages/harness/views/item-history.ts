import type { HarnessEvent } from '@uw/contracts';
import { parseDate } from '@uw/core/dates';
import type { Caller } from '../caller.ts';
import { accepted, type KernelOutcome } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import { harnessScene, type ScenePorts } from '../reads/scene.ts';
import { byPosition } from './flow.ts';

export const HISTORY_EVENT_LIMIT = 5000;
const DAY_MS = 86_400_000;
const historyNames: readonly HarnessEvent['name'][] = [
  'item_created',
  'stage_advanced',
  'loop_edge_taken',
];

export type StageStep = { readonly at: Date; readonly stage: string | null };
export type ItemHistory = { readonly itemId: string; readonly steps: readonly StageStep[] };
export type HistoryFold = { readonly items: readonly ItemHistory[]; readonly unread: number };
export type ItemHistoryRead = HistoryFold & {
  readonly stages: readonly string[];
  readonly capped: boolean;
};
export type FlowCount = {
  readonly day: string;
  readonly stage: string | null;
  readonly items: number;
};
export type CycleDay = {
  readonly day: string;
  readonly finished: number;
  readonly medianDays: number | null;
};
export type BurnDay = { readonly day: string; readonly open: number };

function stageOf(event: HarnessEvent): string | null | undefined {
  const value = event.name === 'item_created' ? event.evidence['stage'] : event.evidence['to'];
  if (value === null) return event.name === 'stage_advanced' ? null : undefined;
  return typeof value === 'string' ? value : undefined;
}

function oldestFirst(events: readonly HarnessEvent[]): readonly HarnessEvent[] {
  return [...events].sort((a, b) => a.at.localeCompare(b.at) || a.position - b.position);
}

export function foldHistories(events: readonly HarnessEvent[]): HistoryFold {
  const steps = new Map<string, StageStep[]>();
  const unread = new Set<string>();
  for (const event of oldestFirst(events)) {
    const stage = stageOf(event);
    if (event.itemId === null || stage === undefined) continue;
    const known = steps.get(event.itemId);
    if (event.name === 'item_created') steps.set(event.itemId, [{ at: new Date(event.at), stage }]);
    else if (known === undefined) unread.add(event.itemId);
    else known.push({ at: new Date(event.at), stage });
  }
  const items = [...steps].map(([itemId, itemSteps]) => ({ itemId, steps: itemSteps }));
  return { items, unread: [...unread].filter((itemId) => !steps.has(itemId)).length };
}

function endOf(day: string): number {
  return parseDate(day).getTime() + DAY_MS;
}

function stageAt(item: ItemHistory, end: number): string | null | undefined {
  let stage: string | null | undefined;
  for (const step of item.steps) if (step.at.getTime() < end) stage = step.stage;
  return stage;
}

function stagesOf(read: Pick<ItemHistoryRead, 'stages' | 'items'>): readonly string[] {
  const seen = read.items.flatMap((item) => item.steps.map((step) => step.stage));
  const named = seen.filter((stage): stage is string => stage !== null);
  return [...new Set([...read.stages, ...named])];
}

export function cumulativeFlow(
  read: Pick<ItemHistoryRead, 'stages' | 'items'>,
  days: readonly string[],
): readonly FlowCount[] {
  const stages = [...stagesOf(read), null];
  return days.flatMap((day) => {
    const now = read.items.map((item) => stageAt(item, endOf(day)));
    return stages.map((stage) => ({
      day,
      stage,
      items: now.filter((at) => at === stage).length,
    }));
  });
}

function finishOf(item: ItemHistory): Date | null {
  return item.steps.find((step) => step.stage === null)?.at ?? null;
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted.at(middle) ?? 0)
      : ((sorted.at(middle - 1) ?? 0) + (sorted.at(middle) ?? 0)) / 2;
  return Math.round(value * 10) / 10;
}

export function cycleTimes(
  items: readonly ItemHistory[],
  days: readonly string[],
): readonly CycleDay[] {
  return days.map((day) => {
    const start = parseDate(day).getTime();
    const cycles = items.flatMap((item) => {
      const finish = finishOf(item)?.getTime();
      const begun = item.steps[0]?.at.getTime();
      if (finish === undefined || begun === undefined) return [];
      return finish >= start && finish < start + DAY_MS ? [(finish - begun) / DAY_MS] : [];
    });
    return { day, finished: cycles.length, medianDays: median(cycles) };
  });
}

export function burndown(
  items: readonly ItemHistory[],
  days: readonly string[],
): readonly BurnDay[] {
  return days.map((day) => {
    const now = items.map((item) => stageAt(item, endOf(day)));
    return { day, open: now.filter((stage) => stage !== undefined && stage !== null).length };
  });
}

export async function itemHistoryView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly harnessId: string; readonly at: Date },
): Promise<KernelOutcome<ItemHistoryRead>> {
  const scene = await harnessScene(ports, tx, caller, input.harnessId, input.at);
  if (scene.status !== 'accepted') return scene;
  const events = await tx.harnessEvents.read.recent({
    since: new Date(0),
    names: historyNames,
    agentsOnly: false,
    limit: HISTORY_EVENT_LIMIT,
    harnessIds: [scene.value.harness.id],
  });
  const stages = byPosition(scene.value.stages).map((stage) => stage.key);
  const folded = foldHistories(events.filter((event) => new Date(event.at) <= input.at));
  return accepted({ ...folded, stages, capped: events.length === HISTORY_EVENT_LIMIT });
}

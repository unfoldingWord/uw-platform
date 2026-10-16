import type { Harness, HarnessEvent, ItemState } from '@uw/contracts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { uncountedItems } from '../views/bots.ts';
import { PLANE_LIMIT, VIEW_LIMIT } from '../views/types.ts';

export const SILENCE_RED_MS = 90 * 60_000;
export const SILENCE_AMBER_MS = 45 * 60_000;
const CHECK = 'check';
const reviewResults: ReadonlySet<unknown> = new Set(['review_posted', 'review_withheld']);

export type SilenceLevel = 'ok' | 'amber' | 'red';
export type WaitingInCheck = { readonly item: ItemState; readonly enteredAt: Date };
export type Silence = {
  readonly harness: Harness;
  readonly level: SilenceLevel;
  readonly waiting: readonly WaitingInCheck[];
  readonly uncounted: number;
  readonly lastReviewStepAt: Date | null;
};
export type SilencePorts = Pick<Ports, 'githubFacts'>;

export function silenceLevel(
  waiting: readonly WaitingInCheck[],
  lastStep: Date | null,
  at: Date,
): SilenceLevel {
  if (waiting.length === 0) return 'ok';
  const waited = at.getTime() - Math.min(...waiting.map((entry) => entry.enteredAt.getTime()));
  const quiet = lastStep === null ? Number.POSITIVE_INFINITY : at.getTime() - lastStep.getTime();
  if (waited >= SILENCE_RED_MS && quiet >= SILENCE_RED_MS) return 'red';
  if (waited >= SILENCE_AMBER_MS && quiet >= SILENCE_AMBER_MS) return 'amber';
  return 'ok';
}

function reviewedSince(events: readonly HarnessEvent[], entry: WaitingInCheck): boolean {
  return events.some(
    (event) =>
      event.itemId === entry.item.itemId &&
      reviewResults.has(event.evidence['result']) &&
      new Date(event.at).getTime() >= entry.enteredAt.getTime(),
  );
}

async function unreviewed(
  tx: StoreTransaction,
  harness: Harness,
  entries: readonly WaitingInCheck[],
): Promise<readonly WaitingInCheck[]> {
  if (entries.length === 0) return [];
  const since = new Date(Math.min(...entries.map((entry) => entry.enteredAt.getTime())));
  const completed = await tx.harnessEvents.read.recent({
    since,
    names: ['run_completed'],
    agentsOnly: false,
    limit: PLANE_LIMIT,
    harnessIds: [harness.id],
  });
  return entries.filter((entry) => !reviewedSince(completed, entry));
}

async function waitingIn(
  tx: StoreTransaction,
  harness: Harness,
  items: readonly ItemState[],
): Promise<readonly WaitingInCheck[]> {
  const candidates = items.filter(
    (item) => item.stageKey === CHECK && item.holder === null && item.gateStatus !== 'done',
  );
  if (candidates.length === 0) return [];
  const entries = await tx.harnessEvents.read.enteredStage(
    harness.id,
    candidates.map((item) => item.itemId),
  );
  const entered = new Map(entries.map((entry) => [entry.itemId, entry.at]));
  const known = candidates.flatMap((item) => {
    const enteredAt = entered.get(item.itemId);
    return enteredAt === undefined ? [] : [{ item, enteredAt }];
  });
  return unreviewed(tx, harness, known);
}

async function reviewRuns(
  tx: StoreTransaction,
  steps: readonly HarnessEvent[],
): Promise<ReadonlySet<string>> {
  const runIds = new Set(
    steps
      .map((event) => event.evidence['runId'])
      .filter((id): id is string => typeof id === 'string'),
  );
  const reviewing = new Set<string>();
  for (const runId of runIds) {
    const run = await tx.harnessRuns.read.byId(runId);
    const delegationId = run?.delegationId ?? null;
    const delegation = delegationId === null ? null : await tx.delegations.read.byId(delegationId);
    if (delegation?.capability === 'review') reviewing.add(runId);
  }
  return reviewing;
}

async function lastReviewStepAt(
  tx: StoreTransaction,
  harness: Harness,
  at: Date,
): Promise<Date | null> {
  const steps = await tx.harnessEvents.read.recent({
    since: new Date(at.getTime() - SILENCE_RED_MS),
    names: ['run_step_recorded'],
    agentsOnly: false,
    limit: PLANE_LIMIT,
    harnessIds: [harness.id],
  });
  const reviewing = await reviewRuns(tx, steps);
  const latest = steps.find((event) => reviewing.has(String(event.evidence['runId'])));
  return latest === undefined ? null : new Date(latest.at);
}

function quietOf(harness: Harness): Silence {
  return { harness, level: 'ok', waiting: [], uncounted: 0, lastReviewStepAt: null };
}

export async function silenceOf(
  ports: SilencePorts,
  tx: StoreTransaction,
  harness: Harness,
  at: Date,
): Promise<Silence> {
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const check = stages.find((stage) => stage.key === CHECK);
  if (harness.paused || check === undefined || check.paused) return quietOf(harness);
  const open = await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT);
  const left = await uncountedItems(ports.githubFacts, [{ harness, items: open }]);
  const waiting = await waitingIn(
    tx,
    harness,
    open.filter((item) => !left.has(item.itemId)),
  );
  const lastStep = waiting.length === 0 ? null : await lastReviewStepAt(tx, harness, at);
  const uncounted = open.filter((item) => item.stageKey === CHECK && left.has(item.itemId)).length;
  return {
    harness,
    level: silenceLevel(waiting, lastStep, at),
    waiting,
    uncounted,
    lastReviewStepAt: lastStep,
  };
}

export async function silences(
  ports: SilencePorts,
  tx: StoreTransaction,
  at: Date,
  within: ReadonlySet<string> | null = null,
): Promise<readonly Silence[]> {
  const found: Silence[] = [];
  for (const harness of await tx.harnesses.read.list()) {
    if (within !== null && !within.has(harness.id)) continue;
    found.push(await silenceOf(ports, tx, harness, at));
  }
  return found;
}

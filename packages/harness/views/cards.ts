import type { Harness } from '@uw/contracts';
import { formatDate, parseDate } from '@uw/core/dates';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../store-ports.ts';
import type { ScenePorts } from '../reads/scene.ts';
import { flowOf } from './flow.ts';
import { daysEnding } from './look.ts';
import { readableHarnesses } from './readable.ts';
import { VIEW_LIMIT, type FlowView } from './types.ts';

export type FlowCard = { readonly flow: FlowView; readonly runs: readonly number[] };

async function runsByHarness(
  tx: StoreTransaction,
  harnesses: readonly Harness[],
  at: Date,
): Promise<ReadonlyMap<string, readonly number[]>> {
  const days = daysEnding(at);
  const since = parseDate(days[0] ?? formatDate(at));
  const counted = await tx.harnessRuns.read.startedPerDayByHarness(
    harnesses.map((harness) => harness.id),
    since,
  );
  return new Map(
    harnesses.map((harness) => {
      const mine = new Map(
        counted.filter((row) => row.harnessId === harness.id).map((row) => [row.day, row.count]),
      );
      return [harness.id, days.map((day) => mine.get(day) ?? 0)];
    }),
  );
}

export async function flowCards(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<readonly FlowCard[]> {
  const shown = await readableHarnesses(ports, tx, caller, at);
  const opens = await Promise.all(
    shown.map(async (harness) => ({
      harness,
      open: await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT),
    })),
  );
  const ids = opens.flatMap(({ open }) => open.map((item) => item.itemId));
  const entries = await tx.harnessEvents.read.enteredStages(ids);
  const costs = await tx.harnessRuns.read.costsByItem(ids);
  const runs = await runsByHarness(tx, shown, at);
  return Promise.all(
    opens.map(async ({ harness, open }) => {
      const mine = new Set(open.map((item) => item.itemId));
      const facts = {
        open,
        entries: entries.filter((entry) => mine.has(entry.itemId)),
        costs: costs.filter((cost) => mine.has(cost.itemId)),
      };
      const stages = await tx.harnessStages.read.forHarness(harness.id);
      const flow = await flowOf(tx, { harness, stages }, facts, at);
      return { flow, runs: runs.get(harness.id) ?? [] };
    }),
  );
}

import type { Harness, HarnessEvent, ItemState } from '@uw/contracts';
import { formatDate, parseDate } from '@uw/core/dates';
import type { Caller } from '../caller.ts';
import type { Ports } from '../ports.ts';
import type { StoreTransaction } from '../store-ports.ts';
import { refusalNames, refusalReasons } from './plane.ts';
import { readableHarnesses } from './readable.ts';
import { VIEW_LIMIT } from './types.ts';

type LookPorts = Pick<Ports, 'grants'>;

export const DAILY_DAYS = 30;
const DAY_MS = 86_400_000;

export type DailyPoint = {
  readonly day: string;
  readonly runs: number;
  readonly gateWaits: number;
};
export type HeldItem = { readonly item: ItemState; readonly harness: Harness };
export type MyItems = { readonly rows: readonly HeldItem[]; readonly capped: boolean };

function daysEnding(at: Date): readonly string[] {
  const today = parseDate(formatDate(at)).getTime();
  return Array.from({ length: DAILY_DAYS }, (_, n) =>
    formatDate(new Date(today - (DAILY_DAYS - 1 - n) * DAY_MS)),
  );
}

async function scopeOf(
  ports: LookPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly harnessId: string | null; readonly at: Date },
): Promise<readonly string[]> {
  const readable = (await readableHarnesses(ports, tx, caller, input.at)).map((h) => h.id);
  if (input.harnessId === null) return readable;
  return readable.includes(input.harnessId) ? [input.harnessId] : [];
}

export async function dailyView(
  ports: LookPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly harnessId: string | null; readonly at: Date },
): Promise<readonly DailyPoint[]> {
  const days = daysEnding(input.at);
  const ids = await scopeOf(ports, tx, caller, input);
  const since = parseDate(days[0] ?? formatDate(input.at));
  const runs = new Map(
    (await tx.harnessRuns.read.startedPerDay(ids, since)).map((row) => [row.day, row.count]),
  );
  const decided = new Map(
    (await tx.gateDecisions.read.decidedPerDay(ids, since)).map((row) => [row.day, row.count]),
  );
  const parked = (await tx.harnessItems.read.parkedSince(ids)).map(formatDate);
  return days.map((day) => ({
    day,
    runs: runs.get(day) ?? 0,
    gateWaits: (decided.get(day) ?? 0) + parked.filter((since) => since <= day).length,
  }));
}

export async function lastEventsView(
  ports: LookPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly itemIds: readonly string[]; readonly at: Date },
): Promise<readonly HarnessEvent[]> {
  const readable = new Set(
    (await readableHarnesses(ports, tx, caller, input.at)).map((harness) => harness.id),
  );
  const events = await tx.harnessEvents.read.latestForItems(input.itemIds);
  return events.filter((event) => readable.has(event.harnessId));
}

export async function refusalsView(
  ports: LookPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly itemIds: readonly string[]; readonly at: Date },
): Promise<readonly HarnessEvent[]> {
  const readable = new Set(
    (await readableHarnesses(ports, tx, caller, input.at)).map((harness) => harness.id),
  );
  const events = await tx.harnessEvents.read.latestForItems(input.itemIds, refusalNames);
  return events.filter(
    (event) => readable.has(event.harnessId) && refusalReasons(event).length > 0,
  );
}

export async function myItemsView(
  ports: LookPorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<MyItems> {
  const harnesses = new Map(
    (await readableHarnesses(ports, tx, caller, at)).map((harness) => [harness.id, harness]),
  );
  const held = await tx.harnessItems.read.claimedBy(caller.actor.identity, VIEW_LIMIT);
  const rows = held.flatMap((item) => {
    const harness = harnesses.get(item.harnessId);
    return harness === undefined ? [] : [{ item, harness }];
  });
  return { rows, capped: held.length === VIEW_LIMIT };
}

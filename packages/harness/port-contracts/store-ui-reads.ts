import { describe, expect, it } from 'vitest';
import { newEventSchema, type Identity } from '@uw/contracts';
import type { Store, StoreTransaction } from '../ports.ts';
import { runOf } from './store-bounded-reads.ts';
import {
  at,
  decisionOf,
  hour,
  itemOf,
  seedDecisionItem,
  seedHarness,
  uid,
} from './store-gateway-fixtures.ts';

type ReadsSubject = () => { readonly store: Store };

const day = 24 * hour;
const later = (hours: number): Date => new Date(at.getTime() + hours * hour);
const ian = 'human:00000000-0000-4000-8000-000000000301' as Identity;
const kim = 'human:00000000-0000-4000-8000-000000000306' as Identity;

function describeRunsPerDay(subject: ReadsSubject): void {
  it('UI-15 startedPerDay counts each named harness runs by UTC day since a date', async () => {
    const base = 0xc000;
    const other = 0xc080;
    const read = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, base, 'gateway-ui-runs');
      await seedHarness(tx, other, 'gateway-ui-runs-other');
      await tx.harnessItems.write.insert(itemOf(base, 1), at);
      await tx.harnessItems.write.insert(itemOf(other, 1), at);
      const starts = [later(-day / hour), later(1), later(2), later(day / hour + 1)];
      for (const [n, startedAt] of starts.entries())
        await tx.harnessRuns.write.insert(runOf(base, n + 1, 1, { startedAt }));
      await tx.harnessRuns.write.insert(runOf(other, 1, 1, { startedAt: later(1) }));
      return {
        mine: await tx.harnessRuns.read.startedPerDay([uid(base)], at),
        none: await tx.harnessRuns.read.startedPerDay([], at),
      };
    });
    expect(read).toEqual({
      mine: [
        { day: '2026-10-01', count: 2 },
        { day: '2026-10-02', count: 1 },
      ],
      none: [],
    });
  });
}

function describeDecisionsPerDay(subject: ReadsSubject): void {
  it('UI-15 decidedPerDay counts each named harness gate decisions by UTC day since a date', async () => {
    const base = 0xc100;
    const read = await subject().store.transaction(async (tx) => {
      await seedDecisionItem(tx, base, 'gateway-ui-decisions');
      for (const [n, decidedAt] of [later(-30), later(1), later(30)].entries())
        await tx.gateDecisions.write.insert(decisionOf(base, n + 1, ian, decidedAt));
      return tx.gateDecisions.read.decidedPerDay([uid(base)], at);
    });
    expect(read).toEqual([
      { day: '2026-10-01', count: 1 },
      { day: '2026-10-02', count: 1 },
    ]);
  });
}

async function seedHolds(tx: StoreTransaction, base: number): Promise<void> {
  await seedHarness(tx, base, `gateway-ui-holds-${base.toString(16)}`);
  const parked = { gateStatus: 'parked', stageKey: 'ship' };
  await tx.harnessItems.write.insert(
    itemOf(base, 1, { ...parked, heldSince: later(2).toISOString() }),
    at,
  );
  await tx.harnessItems.write.insert(
    itemOf(base, 2, { ...parked, heldSince: later(1).toISOString() }),
    at,
  );
  await tx.harnessItems.write.insert(itemOf(base, 3, { heldSince: later(1).toISOString() }), at);
  await tx.harnessItems.write.insert(
    itemOf(base, 4, { holder: ian, claimantKind: 'person', priority: 1 }),
    at,
  );
  await tx.harnessItems.write.insert(
    itemOf(base, 5, { holder: ian, claimantKind: 'person', priority: 9 }),
    at,
  );
  await tx.harnessItems.write.insert(
    itemOf(base, 6, { holder: ian, claimantKind: 'person', gateStatus: 'done' }),
    at,
  );
  await tx.harnessItems.write.insert(itemOf(base, 7, { holder: kim, claimantKind: 'person' }), at);
}

function describeHolds(subject: ReadsSubject): void {
  it('UI-15 parkedSince answers when each parked item began waiting, oldest first', async () => {
    const base = 0xc200;
    const read = await subject().store.transaction(async (tx) => {
      await seedHolds(tx, base);
      return {
        parked: await tx.harnessItems.read.parkedSince([uid(base)]),
        none: await tx.harnessItems.read.parkedSince([]),
      };
    });
    expect(read).toEqual({ parked: [later(1), later(2)], none: [] });
  });

  it('UI-15 claimedBy answers the items an identity holds that are not done, by priority', async () => {
    const base = 0xc300;
    const read = await subject().store.transaction(async (tx) => {
      await seedHolds(tx, base);
      const held = await tx.harnessItems.read.claimedBy(ian, 50);
      return held.filter((item) => item.harnessId === uid(base)).map((item) => item.itemId);
    });
    expect(read).toEqual([uid(base + 15), uid(base + 14)]);
  });
}

function eventOf(base: number, n: number, item: number, hours: number) {
  return newEventSchema.parse({
    eventId: uid(base + 0x40 + n),
    harnessId: uid(base),
    itemId: uid(base + 10 + item),
    name: 'item_reordered',
    at: later(hours).toISOString(),
    actor: ian,
    evidence: { priority: n, before: null },
    traceId: uid(base + 0x80 + n),
    requestId: null,
  });
}

function describeLatestEvents(subject: ReadsSubject): void {
  it('UI-15 latestForItems answers the newest event of each named item', async () => {
    const base = 0xc400;
    const read = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, base, 'gateway-ui-latest');
      for (const n of [1, 2, 3]) await tx.harnessItems.write.insert(itemOf(base, n), at);
      await tx.harnessEvents.write.append([
        eventOf(base, 1, 1, 1),
        eventOf(base, 2, 1, 3),
        eventOf(base, 3, 2, 2),
        eventOf(base, 4, 3, 5),
      ]);
      const latest = await tx.harnessEvents.read.latestForItems([uid(base + 11), uid(base + 12)]);
      return {
        latest: latest.map((event) => [event.itemId, event.eventId]),
        none: await tx.harnessEvents.read.latestForItems([]),
      };
    });
    expect(read).toEqual({
      latest: [
        [uid(base + 11), uid(base + 0x42)],
        [uid(base + 12), uid(base + 0x43)],
      ],
      none: [],
    });
  });
}

export function describeStoreUiReads(adapter: string, subject: ReadsSubject): void {
  describe(`the look's reads on ${adapter}`, () => {
    describeRunsPerDay(subject);
    describeDecisionsPerDay(subject);
    describeHolds(subject);
    describeLatestEvents(subject);
  });
}

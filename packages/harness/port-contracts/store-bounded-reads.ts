import { describe, expect, it } from 'vitest';
import { newEventSchema, type Identity } from '@uw/contracts';
import type { RunRow, Store, StoreTransaction } from '../ports.ts';
import { at, hour, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';

type BoundedSubject = () => { readonly store: Store };

const builder = 'agent:builder' as Identity;

function stepOf(tokensIn: number, tokensOut: number) {
  return {
    step: 'work' as const,
    tokensIn,
    tokensOut,
    costMinor: null,
    computeMinor: null,
    model: 'claude-sonnet-4-5',
    resolvedProvider: 'anthropic',
    toolsCalled: [],
    writes: 0,
    at: at.toISOString(),
  };
}

function runOf(base: number, n: number, item: number, overrides: Partial<RunRow>): RunRow {
  return {
    id: uid(base + 0x60 + n),
    harnessId: uid(base),
    itemId: uid(base + 10 + item),
    persona: builder,
    personaPageId: null,
    delegationId: null,
    runShape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-4-5',
    pinnedProvider: 'anthropic',
    resolvedProvider: null,
    steps: [],
    costMinor: null,
    computeMinor: null,
    costBasis: 'metered',
    traceId: uid(base + 0x90 + n),
    outcome: 'completed',
    hibernatedFor: null,
    failure: null,
    gates: [],
    prompts: [],
    startedAt: new Date(at.getTime() + n * hour),
    endedAt: new Date(at.getTime() + n * hour + 60_000),
    ...overrides,
  };
}

function limitRefused(
  subject: BoundedSubject,
  read: (tx: StoreTransaction, limit: number) => Promise<unknown>,
) {
  return Promise.all(
    [0, 5001, 1.5].map((limit) =>
      expect(subject().store.transaction((tx) => read(tx, limit))).rejects.toBeInstanceOf(
        RangeError,
      ),
    ),
  );
}

function describeOpenItems(subject: BoundedSubject): void {
  it('openFor answers the harness items that are not done, by priority then id, up to the limit', async () => {
    const base = 0x5000;
    const read = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, base, 'gateway-bounded-open');
      await seedHarness(tx, base + 0x80, 'gateway-bounded-open-other');
      await tx.harnessItems.write.insert(itemOf(base, 1, { priority: 1 }), at);
      await tx.harnessItems.write.insert(itemOf(base, 2, { priority: 5, gateStatus: 'done' }), at);
      await tx.harnessItems.write.insert(itemOf(base, 3, { priority: 5, stageKey: 'ship' }), at);
      await tx.harnessItems.write.insert(
        itemOf(base, 4, { priority: 9, gateStatus: 'parked' }),
        at,
      );
      await tx.harnessItems.write.insert(itemOf(base + 0x80, 1), at);
      const ids = async (limit: number) =>
        (await tx.harnessItems.read.openFor(uid(base), limit)).map((item) => item.itemId);
      return { all: await ids(50), two: await ids(2) };
    });
    const [first, , third, fourth] = [1, 2, 3, 4].map((n) => uid(base + 10 + n));
    expect(read).toEqual({ all: [fourth, third, first], two: [fourth, third] });
    await limitRefused(subject, (tx, limit) => tx.harnessItems.read.openFor(uid(base), limit));
  });

  it('parked refuses a limit outside 1 to 5000 and stops at the limit', async () => {
    const base = 0x5100;
    const read = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, base, 'gateway-bounded-parked');
      const parked = { gateStatus: 'parked', stageKey: 'ship' };
      for (const n of [1, 2, 3]) {
        await tx.harnessItems.write.insert(itemOf(base, n, { ...parked, priority: n }), at);
      }
      return (await tx.harnessItems.read.parked(uid(base), 2)).map((item) => item.itemId);
    });
    expect(read).toEqual([uid(base + 13), uid(base + 12)]);
    await limitRefused(subject, (tx, limit) => tx.harnessItems.read.parked(uid(base), limit));
  });
}

async function seedCosts(tx: StoreTransaction, base: number): Promise<void> {
  await seedHarness(tx, base, 'gateway-bounded-costs');
  for (const n of [1, 2, 3]) await tx.harnessItems.write.insert(itemOf(base, n), at);
  const runs = [
    runOf(base, 1, 1, { costMinor: 120, computeMinor: 30, steps: [stepOf(10, 20)] }),
    runOf(base, 2, 1, { costMinor: 5, steps: [stepOf(1, 2), stepOf(3, 4)] }),
    runOf(base, 3, 1, {
      costBasis: 'subscription',
      runShape: 'external-run',
      engine: 'external',
      steps: [stepOf(100, 200)],
    }),
    runOf(base, 4, 2, {}),
  ];
  for (const run of runs) await tx.harnessRuns.write.insert(run);
}

function describeCosts(subject: BoundedSubject): void {
  it('costsByItem sums each item metered cost and tokens apart from its subscription tokens', async () => {
    const base = 0x5200;
    const read = await subject().store.transaction(async (tx) => {
      await seedCosts(tx, base);
      const ids = [1, 2, 3].map((n) => uid(base + 10 + n));
      return {
        costs: await tx.harnessRuns.read.costsByItem(ids),
        none: await tx.harnessRuns.read.costsByItem([]),
      };
    });
    const nothing = { meteredMinor: 0, computeMinor: 0, meteredTokens: 0, subscriptionTokens: 0 };
    expect(read).toEqual({
      costs: [
        {
          itemId: uid(base + 11),
          meteredMinor: 125,
          computeMinor: 30,
          meteredTokens: 40,
          subscriptionTokens: 300,
        },
        { itemId: uid(base + 12), ...nothing },
      ],
      none: [],
    });
  });
}

function createdEvent(base: number, n: number) {
  return newEventSchema.parse({
    eventId: uid(base + 0x40 + n),
    harnessId: uid(base),
    itemId: uid(base + 10 + n),
    name: 'item_created',
    at: at.toISOString(),
    actor: builder,
    evidence: { stage: 'build', title: `Item ${n}`, pageId: null, priority: 0, due: null },
    traceId: uid(base + 0x80 + n),
    requestId: null,
  });
}

function describePositions(subject: BoundedSubject): void {
  it('lastPositions answers the latest event position of each named harness that has events', async () => {
    const base = 0x5300;
    const quiet = 0x5380;
    const read = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, base, 'gateway-bounded-positions');
      await seedHarness(tx, quiet, 'gateway-bounded-positions-quiet');
      for (const n of [1, 2]) await tx.harnessItems.write.insert(itemOf(base, n), at);
      await tx.harnessEvents.write.append([createdEvent(base, 1), createdEvent(base, 2)]);
      return {
        both: await tx.harnessEvents.read.lastPositions([uid(base), uid(quiet)]),
        none: await tx.harnessEvents.read.lastPositions([]),
      };
    });
    expect(read).toEqual({ both: [{ harnessId: uid(base), position: 2 }], none: [] });
  });
}

export function describeStoreBoundedReads(adapter: string, subject: BoundedSubject): void {
  describe(`bounded store reads for the views on ${adapter}`, () => {
    describeOpenItems(subject);
    describeCosts(subject);
    describePositions(subject);
  });
}

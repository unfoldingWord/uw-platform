import { describe, expect, it } from 'vitest';
import { eventNameSchema, newEventSchema, type Identity } from '@uw/contracts';
import type { Delegation, RunRow, Store, StoreTransaction } from '../ports.ts';
import type { SeededPage } from './store-gateways.ts';
import { at, hour, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';

type ViewsSubject = () => {
  readonly store: Store;
  seedPage(page: SeededPage): Promise<void>;
};

const day = 24 * hour;
const person = '00000000-0000-4000-8000-000000000001';
const human = `human:${person}`;
const builder = 'agent:builder' as Identity;

function later(from: Date, ms: number): Date {
  return new Date(from.getTime() + ms);
}

async function seedItems(tx: StoreTransaction, base: number, key: string, count: number) {
  await seedHarness(tx, base, key);
  for (let n = 1; n <= count; n += 1) await tx.harnessItems.write.insert(itemOf(base, n), at);
}

type Seeded = {
  readonly n: number;
  readonly item: number;
  readonly name: string;
  readonly when: Date;
  readonly actor: string;
};

function evidenceOf(seeded: Seeded): Readonly<Record<string, unknown>> | undefined {
  const evidence = new Map<string, Readonly<Record<string, unknown>>>([
    [
      'item_created',
      { stage: 'build', title: `Item ${seeded.item}`, pageId: null, priority: 0, due: null },
    ],
    [
      'item_claimed',
      { holder: seeded.actor, claimantKind: 'agent', delegationId: null, leaseExpiresAt: null },
    ],
    ['stage_advanced', { from: 'build', to: 'review' }],
    ['loop_edge_taken', { from: 'review', to: 'build' }],
  ]);
  return evidence.get(seeded.name);
}

function eventOf(base: number, seeded: Seeded) {
  return newEventSchema.parse({
    eventId: uid(base + 0x40 + seeded.n),
    harnessId: uid(base),
    itemId: uid(base + 10 + seeded.item),
    name: seeded.name,
    at: seeded.when.toISOString(),
    actor: seeded.actor,
    evidence: evidenceOf(seeded),
    traceId: uid(base + 0x80),
    requestId: null,
  });
}

function describeParked(subject: ViewsSubject): void {
  it('parked lists only parked items of the harness in priority order', async () => {
    const ids = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x4000, 'gateway-views-parked');
      await seedHarness(tx, 0x4100, 'gateway-views-parked-other');
      const parked = { gateStatus: 'parked', stageKey: 'ship' };
      await tx.harnessItems.write.insert(itemOf(0x4000, 1, { ...parked, priority: 1 }), at);
      await tx.harnessItems.write.insert(itemOf(0x4000, 2, { ...parked, priority: 5 }), at);
      await tx.harnessItems.write.insert(itemOf(0x4000, 3, { priority: 9 }), at);
      await tx.harnessItems.write.insert(itemOf(0x4000, 4, { ...parked, priority: 5 }), at);
      await tx.harnessItems.write.insert(itemOf(0x4100, 1, parked), at);
      return (await tx.harnessItems.read.parked(uid(0x4000))).map((item) => item.itemId);
    });
    expect(ids).toEqual([uid(0x4000 + 12), uid(0x4000 + 14), uid(0x4000 + 11)]);
  });

  it('byIds answers the named items in id order and nothing for an empty list', async () => {
    const base = 0x4f00;
    const read = await subject().store.transaction(async (tx) => {
      await seedItems(tx, base, 'gateway-views-by-ids', 3);
      const ids = async (itemIds: readonly string[]) =>
        (await tx.harnessItems.read.byIds(itemIds)).map((item) => item.itemId);
      return { two: await ids([uid(base + 13), uid(base + 11), uid(0x4fff)]), none: await ids([]) };
    });
    expect(read).toEqual({ two: [uid(base + 11), uid(base + 13)], none: [] });
  });
}

function describeEntered(subject: ViewsSubject): void {
  it('enteredStage answers each item latest stage entry and nothing for an empty list', async () => {
    const base = 0x4200;
    const read = await subject().store.transaction(async (tx) => {
      await seedItems(tx, base, 'gateway-views-entered', 3);
      await tx.harnessEvents.write.append([
        eventOf(base, { n: 1, item: 1, name: 'item_created', when: at, actor: human }),
        eventOf(base, { n: 2, item: 2, name: 'item_created', when: at, actor: human }),
        eventOf(base, {
          n: 3,
          item: 1,
          name: 'stage_advanced',
          when: later(at, hour),
          actor: human,
        }),
        eventOf(base, {
          n: 4,
          item: 2,
          name: 'item_claimed',
          when: later(at, 2 * hour),
          actor: builder,
        }),
        eventOf(base, {
          n: 5,
          item: 1,
          name: 'loop_edge_taken',
          when: later(at, 3 * hour),
          actor: human,
        }),
      ]);
      const ids = [uid(base + 11), uid(base + 12), uid(base + 13)];
      return {
        entered: await tx.harnessEvents.read.enteredStage(uid(base), ids),
        none: await tx.harnessEvents.read.enteredStage(uid(base), []),
      };
    });
    expect(read).toEqual({
      entered: [
        { itemId: uid(base + 11), at: later(at, 3 * hour) },
        { itemId: uid(base + 12), at },
      ],
      none: [],
    });
  });
}

function describeLastPosition(subject: ViewsSubject): void {
  it('lastPosition answers the latest event position of one harness, and 0 for none', async () => {
    const base = 0x4a00;
    const read = await subject().store.transaction(async (tx) => {
      await seedItems(tx, base, 'gateway-views-last', 1);
      await seedItems(tx, base + 0x80, 'gateway-views-last-other', 1);
      const before = await tx.harnessEvents.read.lastPosition(uid(base));
      await tx.harnessEvents.write.append([
        eventOf(base, { n: 1, item: 1, name: 'item_created', when: at, actor: human }),
        eventOf(base, { n: 2, item: 1, name: 'item_claimed', when: at, actor: builder }),
      ]);
      return {
        before,
        after: await tx.harnessEvents.read.lastPosition(uid(base)),
        other: await tx.harnessEvents.read.lastPosition(uid(base + 0x80)),
      };
    });
    expect(read).toEqual({ before: 0, after: 2, other: 0 });
  });
}

const recentSince = new Date('2031-01-01T00:00:00.000Z');

const recentEvents: readonly Seeded[] = [
  { n: 1, item: 1, name: 'item_created', when: recentSince, actor: human },
  { n: 2, item: 1, name: 'item_claimed', when: later(recentSince, hour), actor: builder },
  { n: 3, item: 1, name: 'stage_advanced', when: later(recentSince, 2 * hour), actor: builder },
  { n: 4, item: 2, name: 'item_created', when: later(recentSince, -hour), actor: builder },
];

function describeRecent(subject: ViewsSubject): void {
  it('recent filters by instant, name and agent actor, newest first, and stops at the limit', async () => {
    const base = 0x4300;
    const read = await subject().store.transaction(async (tx) => {
      await seedItems(tx, base, 'gateway-views-recent', 2);
      await tx.harnessEvents.write.append(recentEvents.map((seeded) => eventOf(base, seeded)));
      const ids = async (names: readonly string[] | null, agentsOnly: boolean, limit: number) => {
        const named = names === null ? null : names.map((name) => eventNameSchema.parse(name));
        const query = { since: recentSince, names: named, agentsOnly, limit };
        return (await tx.harnessEvents.read.recent(query)).map((event) => event.eventId);
      };
      return {
        all: await ids(null, false, 10),
        named: await ids(['item_claimed', 'item_created'], false, 10),
        agents: await ids(null, true, 10),
        first: await ids(null, false, 1),
        none: await ids([], false, 10),
      };
    });
    const [created, claimed, advanced] = [1, 2, 3].map((n) => uid(0x4300 + 0x40 + n));
    expect(read).toEqual({
      all: [advanced, claimed, created],
      named: [claimed, created],
      agents: [advanced, claimed],
      first: [advanced],
      none: [],
    });
  });
}

function describeRecentLimits(subject: ViewsSubject): void {
  it('recent refuses a limit outside 1 to 5000', async () => {
    const query = { since: at, names: null, agentsOnly: false };
    for (const limit of [0, 5001]) {
      await expect(
        subject().store.transaction((tx) => tx.harnessEvents.read.recent({ ...query, limit })),
      ).rejects.toBeInstanceOf(RangeError);
    }
  });
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
    startedAt: at,
    endedAt: null,
    ...overrides,
  };
}

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

function seededRuns(base: number, since: Date): readonly RunRow[] {
  const failedRun = { outcome: 'failed' as const, failure: 'retries_exhausted' as const };
  return [
    runOf(base, 1, 1, {
      ...failedRun,
      costMinor: 100,
      computeMinor: 20,
      steps: [stepOf(1000, 2000)],
      startedAt: since,
      endedAt: later(since, hour),
    }),
    runOf(base, 2, 2, {
      runShape: 'external-run',
      engine: 'external',
      costBasis: 'subscription',
      steps: [stepOf(10, 20), stepOf(5, 5)],
      startedAt: later(since, 2 * hour),
      endedAt: later(since, 4 * hour),
    }),
    runOf(base, 3, 1, {
      ...failedRun,
      costMinor: 50,
      startedAt: later(since, hour / 2),
      endedAt: later(since, 3 * hour),
    }),
    runOf(base, 4, 3, { outcome: 'running', costMinor: 7, startedAt: later(since, -day) }),
  ];
}

async function seedRuns(tx: StoreTransaction, base: number, runs: readonly RunRow[]) {
  await seedItems(tx, base, `gateway-views-runs-${base.toString(16)}`, 3);
  for (const run of runs) await tx.harnessRuns.write.insert(run);
}

function ids(runs: readonly RunRow[]): string[] {
  return runs.map((run) => run.id);
}

function describeRuns(subject: ViewsSubject): void {
  it('forItems and startedSince answer the runs they name in order', async () => {
    const since = new Date('2031-02-01T00:00:00.000Z');
    const runs = seededRuns(0x4400, since);
    const [first, second, third, earlier] = ids(runs);
    const read = await subject().store.transaction(async (tx) => {
      await seedRuns(tx, 0x4400, runs);
      const { read: reads } = tx.harnessRuns;
      return {
        forItems: ids(await reads.forItems([uid(0x4400 + 11), uid(0x4400 + 12)])),
        noItems: ids(await reads.forItems([])),
        started: ids(await reads.startedSince(since, 10)),
        startedTwo: ids(await reads.startedSince(since, 2)),
        all: ids(await reads.startedSince(later(since, -2 * day), 10)),
      };
    });
    expect(read).toEqual({
      forItems: [first, third, second],
      noItems: [],
      started: [first, third, second],
      startedTwo: [first, third],
      all: [earlier, first, third, second],
    });
  });

  it('spendSince totals metered cost and subscription tokens apart, and runCountsSince groups runs by shape and engine', async () => {
    const since = new Date('2032-02-01T00:00:00.000Z');
    const read = await subject().store.transaction(async (tx) => {
      await seedRuns(tx, 0x4600, seededRuns(0x4600, since));
      return {
        spend: await tx.harnessRuns.read.spendSince(since),
        counts: await tx.harnessRuns.read.runCountsSince(since),
        after: await tx.harnessRuns.read.spendSince(later(since, day)),
      };
    });
    expect(read).toEqual({
      spend: { meteredMinor: 150, computeMinor: 20, subscriptionTokens: 40 },
      counts: [
        { runShape: 'external-run', engine: 'external', count: 1 },
        { runShape: 'workflow-run', engine: 'claude-messages', count: 2 },
      ],
      after: { meteredMinor: 0, computeMinor: 0, subscriptionTokens: 0 },
    });
  });
}

function describeRunLimits(subject: ViewsSubject): void {
  it('startedSince refuses a limit outside 1 to 5000', async () => {
    for (const limit of [0, 5001]) {
      await expect(
        subject().store.transaction((tx) => tx.harnessRuns.read.startedSince(at, limit)),
      ).rejects.toBeInstanceOf(RangeError);
    }
  });
}

function delegationOf(n: number, overrides: Partial<Delegation>): Delegation {
  return {
    id: uid(0x4700 + 0x10 + n),
    personId: person,
    persona: 'agent:one' as Identity,
    harnessId: uid(0x4700),
    capability: 'iterate',
    grantedAt: new Date('2031-12-01T00:00:00.000Z'),
    expiresAt: new Date('2032-03-01T00:00:00.000Z'),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
    ...overrides,
  };
}

const lapseNow = new Date('2032-01-08T00:00:00.000Z');

const delegationsSeeded: readonly Delegation[] = [
  delegationOf(1, { lapsedAt: later(lapseNow, -day), expiresAt: later(lapseNow, -2 * day) }),
  delegationOf(2, { expiresAt: later(lapseNow, -3 * day) }),
  delegationOf(3, { expiresAt: later(lapseNow, day) }),
  delegationOf(4, { lapsedAt: later(lapseNow, -10 * day), expiresAt: later(lapseNow, -10 * day) }),
  delegationOf(5, { lapsedAt: later(lapseNow, -hour), revokedAt: later(lapseNow, -2 * hour) }),
  delegationOf(6, { lapsedAt: later(lapseNow, -2 * day), expiresAt: later(lapseNow, 5 * day) }),
];

function describeLapsed(subject: ViewsSubject): void {
  it('lapsedFor answers only the person lapsed delegations since the instant', async () => {
    const since = later(lapseNow, -7 * day);
    const read = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x4700, 'gateway-views-lapsed');
      for (const [n, delegation] of delegationsSeeded.entries()) {
        await tx.delegations.write.insert(delegation, uid(0x4780 + n));
      }
      const lapsed = async (who: string) =>
        (await tx.delegations.read.lapsedFor(who, since, lapseNow)).map((row) => row.id);
      return { mine: await lapsed(person), theirs: await lapsed(uid(0x47ff)) };
    });
    const [first, second, , , , sixth] = delegationsSeeded.map((delegation) => delegation.id);
    expect(read).toEqual({ mine: [first, sixth, second], theirs: [] });
  });
}

function learningOf(n: number, status: SeededPage['status'], frontmatter: object): SeededPage {
  return {
    id: uid(0x4800 + n),
    type: 'learning',
    status,
    jdArea: '80-89',
    title: `Learning ${n}`,
    bodyMd: 'what we learned',
    frontmatter: { supersedes: [], review_by: null, ...frontmatter },
    slug: `gateway-views-learning-${n}`,
  };
}

const reviewed = { as_of: '2026-01-01', review_by: '2026-09-01' };

const learnings: readonly SeededPage[] = [
  learningOf(1, 'active', { confidence: 'assumed', ...reviewed }),
  learningOf(2, 'draft', { confidence: 'inferred', as_of: '2026-06-01' }),
  learningOf(3, 'active', { confidence: 'observed', ...reviewed }),
  learningOf(4, 'retired', { confidence: 'assumed', ...reviewed }),
  learningOf(5, 'active', { confidence: 'inferred', ...reviewed, review_by: '2026-12-01' }),
  learningOf(6, 'active', { confidence: 'assumed', as_of: '2026-07-10' }),
  learningOf(7, 'active', { confidence: 'assumed', as_of: 'last spring', review_by: 'soon' }),
  learningOf(8, 'active', { confidence: 'inferred', as_of: '2026-02-31' }),
];

function describeStaleLearnings(subject: ViewsSubject): void {
  it('staleLearnings answers assumed and inferred learnings past their review date and never a retired one', async () => {
    for (const page of learnings) await subject().seedPage(page);
    const mine = new Set(learnings.map((page) => page.id));
    const stale = await subject().store.transaction((tx) =>
      tx.pages.read.staleLearnings('2026-10-03', 5000),
    );
    expect(stale.map((page) => page.id).filter((id) => mine.has(id))).toEqual([
      uid(0x4801),
      uid(0x4802),
    ]);
    await expect(
      subject().store.transaction((tx) => tx.pages.read.staleLearnings('October 3', 10)),
    ).rejects.toBeInstanceOf(RangeError);
  });
}

export function describeStoreViews(adapter: string, subject: ViewsSubject): void {
  describe(`store reads for the views on ${adapter}`, () => {
    describeParked(subject);
    describeEntered(subject);
    describeLastPosition(subject);
    describeRecent(subject);
    describeRecentLimits(subject);
    describeRuns(subject);
    describeRunLimits(subject);
    describeLapsed(subject);
    describeStaleLearnings(subject);
  });
}

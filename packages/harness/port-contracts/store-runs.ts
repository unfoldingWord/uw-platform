import { describe, expect, it } from 'vitest';
import { newEventSchema, type EventName, type Identity } from '@uw/contracts';
import type { RunRow, Store, StoreTransaction } from '../ports.ts';
import type { SeededPage } from './store-gateways.ts';
import { at, hour, itemOf, refusedBy, seedHarness, uid } from './store-gateway-fixtures.ts';

type RunsSubject = () => {
  readonly store: Store;
  seedPage(page: SeededPage): Promise<void>;
};

const builder = 'agent:builder' as Identity;

function runOf(base: number, n: number, item: number, overrides: Partial<RunRow> = {}): RunRow {
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
    outcome: 'running',
    hibernatedFor: null,
    failure: null,
    gates: [],
    prompts: [],
    startedAt: at,
    endedAt: null,
    ...overrides,
  };
}

async function seedItems(tx: StoreTransaction, base: number, key: string, count: number) {
  await seedHarness(tx, base, key);
  for (let n = 1; n <= count; n += 1) await tx.harnessItems.write.insert(itemOf(base, n), at);
}

const fullRun = runOf(0x3000, 1, 1, {
  runShape: 'external-run',
  engine: 'external',
  resolvedProvider: 'anthropic',
  steps: [
    {
      step: 'work',
      tokensIn: 120,
      tokensOut: 340,
      costMinor: null,
      computeMinor: null,
      model: 'claude-sonnet-4-5',
      resolvedProvider: 'anthropic',
      toolsCalled: ['read_page'],
      writes: 1,
      at: at.toISOString(),
    },
  ],
  costBasis: 'subscription',
  gates: ['build'],
  prompts: ['look at the tests first'],
});

function describeRoundTrip(subject: RunsSubject): void {
  it('inserts a run and reads every field back by id, and null for a missing id', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seedItems(tx, 0x3000, 'gateway-runs-round-trip', 1);
      await tx.harnessRuns.write.insert(fullRun);
      return [
        await tx.harnessRuns.read.byId(fullRun.id),
        await tx.harnessRuns.read.lock(fullRun.id),
        await tx.harnessRuns.read.byId(uid(0x30ff)),
        await tx.harnessRuns.read.lock(uid(0x30ff)),
      ];
    });
    expect(read).toEqual([fullRun, fullRun, null, null]);
  });

  it('updates every mutable column, answering true, and false for a missing id', async () => {
    const run = runOf(0x3100, 1, 1);
    const ended = {
      ...run,
      resolvedProvider: 'anthropic',
      steps: fullRun.steps,
      costMinor: 12,
      computeMinor: 3,
      outcome: 'hibernated',
      hibernatedFor: 'gate',
      gates: ['ship'],
      prompts: ['one', 'two'],
      endedAt: new Date(at.getTime() + hour),
    } satisfies RunRow;
    const result = await subject().store.transaction(async (tx) => {
      await seedItems(tx, 0x3100, 'gateway-runs-update', 1);
      await tx.harnessRuns.write.insert(run);
      const changed = await tx.harnessRuns.write.update(ended);
      const missing = await tx.harnessRuns.write.update({ ...ended, id: uid(0x31ff) });
      return { changed, missing, read: await tx.harnessRuns.read.byId(run.id) };
    });
    expect(result).toEqual({ changed: true, missing: false, read: ended });
  });
}

function describeRefusals(subject: RunsSubject): void {
  it('refuses a second live run on one item, naming harness_runs_one_live_per_item', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedItems(tx, 0x3200, 'gateway-runs-one-live', 1);
      await tx.harnessRuns.write.insert(
        runOf(0x3200, 1, 1, { outcome: 'hibernated', hibernatedFor: 'paused' }),
      );
      await tx.harnessRuns.write.insert(runOf(0x3200, 2, 1));
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23505', constraint: 'harness_runs_one_live_per_item' });
  });

  it('lets an item whose earlier run completed take a new live run', async () => {
    const live = await subject().store.transaction(async (tx) => {
      await seedItems(tx, 0x3300, 'gateway-runs-after-completed', 1);
      const done = runOf(0x3300, 1, 1, { outcome: 'completed', endedAt: at });
      await tx.harnessRuns.write.insert(done);
      await tx.harnessRuns.write.insert(runOf(0x3300, 2, 1));
      return (await tx.harnessRuns.read.liveForItem(uid(0x3300 + 11)))?.id ?? null;
    });
    expect(live).toBe(uid(0x3300 + 0x62));
  });

  it('refuses a subscription run that carries a cost', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedItems(tx, 0x3400, 'gateway-runs-subscription', 1);
      await tx.harnessRuns.write.insert(
        runOf(0x3400, 1, 1, { costBasis: 'subscription', computeMinor: 4 }),
      );
    }, subject().store);
    expect(outcome).toMatchObject({
      code: '23514',
      constraint: 'harness_runs_subscription_has_no_cost',
    });
  });

  it('refuses a hibernated run that does not say why', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedItems(tx, 0x3500, 'gateway-runs-hibernated', 1);
      await tx.harnessRuns.write.insert(runOf(0x3500, 1, 1, { outcome: 'hibernated' }));
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23514', constraint: 'harness_runs_hibernated_has_why' });
  });
}

function describeLive(subject: RunsSubject): void {
  it('lists the running and hibernated runs of a harness, or of every harness, in id order', async () => {
    const result = await subject().store.transaction(async (tx) => {
      await seedItems(tx, 0x3600, 'gateway-runs-live-a', 4);
      await seedItems(tx, 0x3700, 'gateway-runs-live-b', 1);
      await tx.harnessRuns.write.insert(runOf(0x3600, 1, 1));
      await tx.harnessRuns.write.insert(
        runOf(0x3600, 2, 2, { outcome: 'hibernated', hibernatedFor: 'breaker' }),
      );
      await tx.harnessRuns.write.insert(runOf(0x3600, 3, 3, { outcome: 'stopped', endedAt: at }));
      await tx.harnessRuns.write.insert(
        runOf(0x3600, 4, 4, { outcome: 'failed', failure: 'turn_limit', endedAt: at }),
      );
      await tx.harnessRuns.write.insert(runOf(0x3700, 1, 1));
      const ids = (rows: readonly RunRow[]) => rows.map((row) => row.id);
      const ours = new Set([0x3661, 0x3662, 0x3663, 0x3664, 0x3761].map(uid));
      return {
        harness: ids(await tx.harnessRuns.read.live(uid(0x3600))),
        every: ids(await tx.harnessRuns.read.live(null)).filter((id) => ours.has(id)),
        none: await tx.harnessRuns.read.liveForItem(uid(0x3600 + 13)),
      };
    });
    expect(result).toEqual({
      harness: [uid(0x3661), uid(0x3662)],
      every: [uid(0x3661), uid(0x3662), uid(0x3761)],
      none: null,
    });
  });
}

function breakerEvent(base: number, n: number, name: EventName, minute: number) {
  return newEventSchema.parse({
    eventId: uid(base + 0x40 + n),
    harnessId: uid(base),
    itemId: null,
    name,
    at: new Date(at.getTime() + minute * 60_000).toISOString(),
    actor: 'human:00000000-0000-4000-8000-000000000001',
    evidence: { spentMinor: 100, capMinor: 1000, currency: 'USD', percent: 10 },
    traceId: uid(base + 0x80),
    requestId: null,
  });
}

function describeLatestNamed(subject: RunsSubject): void {
  it('answers the newest event with one of the names, in one harness or in any, and null when none', async () => {
    const names: readonly EventName[] = ['breaker_holding', 'breaker_open'];
    const result = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x3800, 'gateway-runs-latest-a');
      await seedHarness(tx, 0x3900, 'gateway-runs-latest-b');
      await tx.harnessEvents.write.append([
        breakerEvent(0x3800, 1, 'breaker_holding', 1),
        breakerEvent(0x3800, 2, 'breaker_pausing', 9),
      ]);
      await tx.harnessEvents.write.append([breakerEvent(0x3900, 1, 'breaker_open', 5)]);
      const read = tx.harnessEvents.read;
      return {
        harness: (await read.latestNamed(names, uid(0x3800)))?.eventId,
        any: (await read.latestNamed(names, null))?.eventId,
        none: await read.latestNamed(['hosted_builder_set'], uid(0x3800)),
        empty: await read.latestNamed([], null),
      };
    });
    expect(result).toEqual({
      harness: uid(0x3841),
      any: uid(0x3941),
      none: null,
      empty: null,
    });
  });
}

function personaPage(n: number, overrides: Partial<SeededPage>, frontmatter: object): SeededPage {
  return {
    id: uid(0x3a00 + 0x20 + n),
    type: 'persona',
    status: 'active',
    jdArea: '80-89',
    title: `Persona ${n}`,
    bodyMd: 'body',
    slug: `gateway-runs-persona-${n}`,
    ...overrides,
    frontmatter: { identity: 'agent:builder', harness: uid(0x3a00), ...frontmatter },
  };
}

function describeActivePersona(subject: RunsSubject): void {
  it('finds the active persona page by identity and harness, and null otherwise', async () => {
    await subject().store.transaction((tx) => seedHarness(tx, 0x3a00, 'gateway-runs-persona'));
    await subject().seedPage(personaPage(1, {}, {}));
    await subject().seedPage(
      personaPage(2, { status: 'suggested' }, { identity: 'agent:suggested' }),
    );
    const result = await subject().store.transaction(async (tx) => {
      const read = tx.pages.read;
      return {
        found: (await read.activePersona(builder, uid(0x3a00)))?.id,
        suggested: await read.activePersona('agent:suggested' as Identity, uid(0x3a00)),
        otherHarness: await read.activePersona(builder, uid(0x3aff)),
        otherIdentity: await read.activePersona('agent:other' as Identity, uid(0x3a00)),
      };
    });
    expect(result).toEqual({
      found: uid(0x3a21),
      suggested: null,
      otherHarness: null,
      otherIdentity: null,
    });
  });
}

export function describeStoreRuns(adapter: string, subject: RunsSubject): void {
  describe(`DX-3 store runs gateway on ${adapter}`, () => {
    describeRoundTrip(subject);
    describeRefusals(subject);
    describeLive(subject);
    describeLatestNamed(subject);
    describeActivePersona(subject);
  });
}

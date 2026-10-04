import { describe, expect, it } from 'vitest';
import type { Identity } from '@uw/contracts';
import type { Delegation, RunRow, Store, StoreTransaction } from '../ports.ts';
import { at, hour, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';

type FailedForSubject = () => { readonly store: Store };

const firstWindow = new Date('2033-03-01T00:00:00.000Z').getTime();
const builder = 'agent:builder' as Identity;

function sinceOf(base: number): Date {
  return new Date(firstWindow + ((base - 0x4b00) / 0x100) * 30 * 24 * hour);
}

function laterOf(base: number, ms: number): Date {
  return new Date(sinceOf(base).getTime() + ms);
}

const person = '00000000-0000-4000-8000-000000000001';

function strangerOf(base: number): string {
  return uid(base + 0xf2);
}

function failedRunOf(base: number, n: number, item: number, overrides: Partial<RunRow>): RunRow {
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
    outcome: 'failed',
    hibernatedFor: null,
    failure: 'retries_exhausted',
    gates: [],
    prompts: [],
    startedAt: sinceOf(base),
    endedAt: laterOf(base, hour),
    ...overrides,
  };
}

function delegationOf(base: number): Delegation {
  return {
    id: uid(base + 0xd1),
    personId: person,
    persona: builder,
    harnessId: uid(base),
    capability: 'build',
    grantedAt: at,
    expiresAt: laterOf(base, 60 * 24 * hour),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
  };
}

type Seed = {
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly runs: (base: number) => readonly RunRow[];
};

async function seeded(tx: StoreTransaction, base: number, seed: Seed): Promise<void> {
  await seedHarness(tx, base, `gateway-failed-for-${base.toString(16)}`);
  await tx.delegations.write.insert(delegationOf(base), uid(base + 0xd9));
  for (const [n, overrides] of seed.items.entries()) {
    await tx.harnessItems.write.insert(itemOf(base, n + 1, overrides), at);
  }
  for (const run of seed.runs(base)) await tx.harnessRuns.write.insert(run);
}

async function failedFor(subject: FailedForSubject, base: number, seed: Seed) {
  return subject().store.transaction(async (tx) => {
    await seeded(tx, base, seed);
    const ids = async (personId: string, limit: number) =>
      (await tx.harnessRuns.read.failedFor(personId, [uid(base)], sinceOf(base), limit)).map(
        (run) => run.id,
      );
    return { mine: await ids(person, 50), stranger: await ids(strangerOf(base), 50) };
  });
}

function onePath(base: number, overrides: Partial<RunRow>, item: Record<string, unknown> = {}) {
  return {
    items: [item, {}],
    runs: () => [failedRunOf(base, 1, 1, overrides), failedRunOf(base, 2, 2, {})],
  };
}

function describeOwnership(subject: FailedForSubject): void {
  it('failedFor answers a failed run on a delegation the person gave', async () => {
    const base = 0x4b00;
    const read = await failedFor(subject, base, onePath(base, { delegationId: uid(base + 0xd1) }));
    expect(read).toEqual({ mine: [uid(base + 0x61)], stranger: [] });
  });

  it('failedFor answers a failed run on an item the person holds', async () => {
    const base = 0x4c00;
    const holder = { holder: `human:${person}`, claimantKind: 'person' };
    const read = await failedFor(subject, base, onePath(base, {}, holder));
    expect(read).toEqual({ mine: [uid(base + 0x61)], stranger: [] });
  });

  it('failedFor answers a failed run by a device of the person', async () => {
    const base = 0x4d00;
    const device = {
      persona: `agent:${person}/laptop` as Identity,
      runShape: 'external-run' as const,
      engine: 'external' as const,
    };
    const read = await failedFor(subject, base, onePath(base, device));
    expect(read).toEqual({ mine: [uid(base + 0x61)], stranger: [] });
  });
}

function windowRuns(base: number): readonly RunRow[] {
  const delegationId = uid(base + 0xd1);
  return [
    failedRunOf(base, 1, 1, { delegationId, endedAt: laterOf(base, hour) }),
    failedRunOf(base, 2, 2, { delegationId, endedAt: laterOf(base, 3 * hour) }),
    failedRunOf(base, 3, 3, { delegationId, endedAt: laterOf(base, 2 * hour) }),
    failedRunOf(base, 4, 3, {
      delegationId,
      outcome: 'completed',
      failure: null,
      startedAt: laterOf(base, 4 * hour),
      endedAt: laterOf(base, 5 * hour),
    }),
    failedRunOf(base, 5, 4, {
      delegationId,
      startedAt: laterOf(base, -3 * hour),
      endedAt: laterOf(base, -hour),
    }),
  ];
}

function describeWindow(subject: FailedForSubject): void {
  it('failedFor answers newest first, leaves out a retried run and one before the window, and stops at the limit', async () => {
    const base = 0x4e00;
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx, base, { items: [{}, {}, {}, {}], runs: windowRuns });
      const ids = async (limit: number) =>
        (await tx.harnessRuns.read.failedFor(person, [uid(base)], sinceOf(base), limit)).map(
          (run) => run.id,
        );
      return { all: await ids(50), one: await ids(1) };
    });
    expect(read).toEqual({ all: [uid(base + 0x62), uid(base + 0x61)], one: [uid(base + 0x62)] });
  });

  it('failedFor refuses a limit outside 1 to 5000', async () => {
    for (const limit of [0, 5001]) {
      await expect(
        subject().store.transaction((tx) =>
          tx.harnessRuns.read.failedFor(uid(1), [uid(0x4b00)], sinceOf(0x4b00), limit),
        ),
      ).rejects.toBeInstanceOf(RangeError);
    }
  });
}

function describeHarnesses(subject: FailedForSubject): void {
  it('failedFor answers only runs on the harnesses it is given, and nothing for none', async () => {
    const [first, second] = [0x5400, 0x5500];
    const seed = (base: number) => onePath(base, { delegationId: uid(base + 0xd1) });
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx, first, seed(first));
      await seeded(tx, second, seed(second));
      const ids = async (harnessIds: readonly string[]) =>
        (await tx.harnessRuns.read.failedFor(person, harnessIds, sinceOf(first), 50)).map(
          (run) => run.id,
        );
      return {
        one: await ids([uid(first)]),
        both: await ids([uid(first), uid(second)]),
        none: await ids([]),
      };
    });
    expect(read).toEqual({
      one: [uid(first + 0x61)],
      both: [uid(second + 0x61), uid(first + 0x61)],
      none: [],
    });
  });
}

export function describeStoreFailedFor(adapter: string, subject: FailedForSubject): void {
  describe(`failed runs of one person on ${adapter}`, () => {
    describeOwnership(subject);
    describeWindow(subject);
    describeHarnesses(subject);
  });
}

import { defaultCiChecks } from '@uw/contracts';
import type { Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { software, type Caller, type Clock, type Grants, type KernelOutcome } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { platformGrants } from '../ports/grants.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const hour = 60 * 60 * 1000;

type Movable = Clock & { advance(milliseconds: number): void };

type Race = {
  readonly first: Database;
  readonly second: Database;
  readonly clock: Movable;
  readonly ian: Principal;
  readonly harnessId: string;
  readonly dead: string;
};

function movableClock(): Movable {
  let current = Date.now();
  return { now: () => new Date(current), advance: (ms) => void (current += ms) };
}

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function raceOn(first: Database, second: Database): Promise<Race> {
  const clock = movableClock();
  const ian = await personOn(first, ianId, 'ian.lindsley@unfoldingword.org', clock.now());
  const kernel = kernelOn(first, clock);
  const harnessId = crypto.randomUUID();
  accepted(
    await kernel.stages.activate(caller(ian), {
      harnessId,
      harnessKey: 'software',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-platform',
      requiredChecks: [...defaultCiChecks],
    }),
    'activate',
  );
  const granted = await kernel.delegations.grant(caller(ian), {
    maxTier: null,
    harnessId,
    persona: 'agent:builder',
    capability: 'build',
    expiresAt: new Date(clock.now().getTime() + hour),
    supersedes: null,
  });
  clock.advance(2 * hour);
  return { first, second, clock, ian, harnessId, dead: accepted(granted, 'grant').id };
}

async function withRace(work: (race: Race) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const first = createClient(database.connectionString);
  const second = createClient(database.connectionString);
  try {
    await work(await raceOn(first, second));
  } finally {
    await Promise.all([first.$client.end(), second.$client.end()]);
    await database.drop();
  }
}

function heldGrants(grants: Grants, reached: () => void, resume: Promise<void>): Grants {
  return {
    resolve: (personId, at) => grants.resolve(personId, at),
    resolveIn: (tx, personId, at) => grants.resolveIn(tx, personId, at),
    lockAndReread: async (tx, personId, at) => {
      const locked = await grants.lockAndReread(tx, personId, at);
      reached();
      await resume;
      return locked;
    },
    holders: (area, at) => grants.holders(area, at),
  };
}

function renewal(race: Race) {
  return {
    harnessId: race.harnessId,
    persona: 'agent:builder',
    capability: 'build' as const,
    maxTier: null,
    expiresAt: null,
    supersedes: race.dead,
  };
}

async function renewTwice(race: Race) {
  let reached = (): void => undefined;
  const atLock = new Promise<void>((resolve) => void (reached = resolve));
  let resume = (): void => undefined;
  const resumed = new Promise<void>((resolve) => void (resume = resolve));
  const paused = kernelOn(race.first, race.clock, {
    grants: heldGrants(platformGrants(race.first), reached, resumed),
  });
  const held = paused.delegations.grant(caller(race.ian), renewal(race));
  await atLock;
  const other = await kernelOn(race.second, race.clock).delegations.grant(
    caller(race.ian),
    renewal(race),
  );
  resume();
  return [await held, other];
}

async function liveRenewals(race: Race): Promise<number> {
  const rows = await race.second.$client`
    SELECT count(*)::int AS n FROM delegations WHERE supersedes = ${race.dead}`;
  return Number(rows[0]?.n);
}

async function oneRenewalWins(race: Race): Promise<void> {
  const [held, other] = await renewTwice(race);
  expect([held?.status, other?.status]).toEqual(['error', 'accepted']);
  expect(held).toMatchObject({ reason: 'stale_version' });
  expect(await liveRenewals(race)).toBe(1);
}

describe.skipIf(!testServer)('KN-16 DX-6 two renewals of one expired delegation', () => {
  it('lets one renewal insert and refuses the other stale_version', () => withRace(oneRenewalWins));
});

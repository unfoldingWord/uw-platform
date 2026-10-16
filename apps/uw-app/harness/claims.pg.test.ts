import { defaultCiChecks } from '@uw/contracts';
import type { HarnessEvent, Principal } from '@uw/contracts';
import { systemPrincipal } from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import {
  LEASE_MS,
  readAllEvents,
  software,
  type Caller,
  type Clock,
  type KernelOutcome,
} from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { platformStore } from '../ports/store.ts';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';

const connectionCount = 8;
const rounds = 5;
const ianId = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000104';
const ownerEmail = 'person4@unfoldingword.org';

type Rig = {
  readonly connections: readonly Database[];
  readonly clock: Clock & { advance(milliseconds: number): void };
  readonly ian: Principal;
  readonly owner: Principal;
};

type Round = { readonly rig: Rig; readonly harnessId: string; readonly itemIds: readonly string[] };

async function withSharedDatabase(work: (connections: readonly Database[]) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections = Array.from({ length: connectionCount }, () =>
    createClient(database.connectionString),
  );
  try {
    await work(connections);
  } finally {
    await Promise.all(connections.map((db) => db.$client.end()));
    await database.drop();
  }
}

function movableClock(): Rig['clock'] {
  let current = Date.now();
  return {
    now: () => new Date(current),
    advance: (milliseconds) => void (current += milliseconds),
  };
}

async function rigOn(connections: readonly Database[]): Promise<Rig> {
  const [first] = connections;
  if (first === undefined) throw new Error('no connections');
  const clock = movableClock();
  await seedPerson(first, { id: ownerId, email: ownerEmail });
  await seedGrant(first, {
    id: '00000000-0000-4000-8000-000000020400',
    personId: ownerId,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: clock.now(),
    expiresAt: null,
  });
  const ian = await personOn(first, ianId, 'ian.lindsley@unfoldingword.org', clock.now());
  const owner = await personOn(first, ownerId, ownerEmail, clock.now());
  return { connections, clock, ian, owner };
}

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function openRound(
  rig: Rig,
  round: number,
  options: { readonly wipLimit: number; readonly items: number },
): Promise<Round> {
  const [first] = rig.connections;
  if (first === undefined) throw new Error('no connections');
  const kernel = kernelOn(first, rig.clock);
  const harnessId = crypto.randomUUID();
  accepted(
    await kernel.stages.activate(caller(rig.ian), {
      harnessId,
      harnessKey: `software-${round}`,
      jdArea: '80-89',
      template: software,
      repository: null,
      requiredChecks: [...defaultCiChecks],
    }),
  );
  accepted(
    await kernel.stages.updateStage(caller(rig.ian), {
      harnessId,
      stageKey: 'package',
      change: { agentPickup: 'allowed', wipLimit: options.wipLimit },
    }),
  );
  const itemIds: string[] = [];
  for (let n = 0; n < options.items; n += 1) {
    const item = accepted(
      await kernel.items.enqueue(caller(rig.owner), {
        harnessId,
        title: `Race ${round}.${n}`,
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    itemIds.push(item.itemId);
  }
  return { rig, harnessId, itemIds };
}

function connectionAt(rig: Rig, n: number): Database {
  const db = rig.connections[n];
  if (db === undefined) throw new Error(`no connection ${n}`);
  return db;
}

function claimOn(round: Round, n: number, itemId: string, persona: string) {
  const kernel = kernelOn(connectionAt(round.rig, n), round.rig.clock);
  return kernel.items.claim(caller(agentOf(round.rig.owner, persona)), {
    itemId,
    delegationId: null,
  });
}

function reasons(outcomes: readonly KernelOutcome<unknown>[]): string[] {
  return outcomes.flatMap((outcome) => (outcome.status === 'error' ? [outcome.reason] : []));
}

function accepts(outcomes: readonly KernelOutcome<unknown>[]): number {
  return outcomes.filter((outcome) => outcome.status === 'accepted').length;
}

async function eventsNamed(round: Round, name: string, itemId: string | null) {
  const store = platformStore(connectionAt(round.rig, 0));
  const all: readonly HarnessEvent[] = await store.transaction((tx) =>
    readAllEvents(tx, round.harnessId, itemId),
  );
  return all.filter((event) => event.name === name);
}

async function eachRound(
  connections: readonly Database[],
  options: { readonly wipLimit: number; readonly items: number },
  check: (round: Round) => Promise<void>,
) {
  const rig = await rigOn(connections);
  for (let n = 0; n < rounds; n += 1) {
    await check(await openRound(rig, n, options));
  }
}

async function oneItemRace(round: Round) {
  const [itemId] = round.itemIds;
  if (itemId === undefined) throw new Error('no item');
  const outcomes = await Promise.all(
    round.rig.connections.map((_, n) => claimOn(round, n, itemId, `builder-${n}`)),
  );
  expect(accepts(outcomes)).toBe(1);
  expect(reasons(outcomes)).toEqual(Array(connectionCount - 1).fill('lease_held'));
  expect(await eventsNamed(round, 'item_claimed', itemId)).toHaveLength(1);
}

async function wipSlotRace(round: Round) {
  const outcomes = await Promise.all(
    round.itemIds.map((itemId, n) => claimOn(round, n + 1, itemId, `builder-${n}`)),
  );
  expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['accepted', 'error']);
  expect(reasons(outcomes)).toEqual(['wip_limit_reached']);
  expect(await eventsNamed(round, 'item_claimed', null)).toHaveLength(1);
}

async function sweepRace(round: Round) {
  const [itemId] = round.itemIds;
  if (itemId === undefined) throw new Error('no item');
  accepted(await claimOn(round, 0, itemId, 'builder-first'));
  round.rig.clock.advance(LEASE_MS + 1000);
  const sweep = (n: number) =>
    kernelOn(connectionAt(round.rig, n), round.rig.clock).items.expireLeases(
      caller(systemPrincipal()),
      { limit: 10 },
    );
  const [claimed] = await Promise.all([
    claimOn(round, 1, itemId, 'builder-second'),
    sweep(2),
    sweep(3),
  ]);
  expect(claimed.status).toBe('accepted');
  expect(await eventsNamed(round, 'lease_expired', itemId)).toHaveLength(1);
  expect(await eventsNamed(round, 'item_claimed', itemId)).toHaveLength(2);
}

describe.skipIf(!testServer)('DX-6 claims race on separate connections', () => {
  it('KN-5 lets exactly one of eight concurrent claims on one item succeed', () =>
    withSharedDatabase((connections) =>
      eachRound(connections, { wipLimit: 3, items: 1 }, oneItemRace),
    ));

  it('lets one of two claims racing one WIP slot succeed', () =>
    withSharedDatabase((connections) =>
      eachRound(connections, { wipLimit: 1, items: 2 }, wipSlotRace),
    ));

  it('writes lease_expired once when a claim races the sweep on a lapsed lease', () =>
    withSharedDatabase((connections) =>
      eachRound(connections, { wipLimit: 3, items: 1 }, sweepRace),
    ));
});

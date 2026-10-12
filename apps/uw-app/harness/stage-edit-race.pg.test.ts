import type { Principal, Stage } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { lockWaiters } from '@uw/db/store';
import { software, type Caller, type Clock, type KernelOutcome } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const instant = new Date();
const clock: Clock = { now: () => instant };

type Connections = {
  readonly gate: Database;
  readonly wip: Database;
  readonly holder: Database;
  readonly observer: Database;
};

type Race = {
  readonly connections: Connections;
  readonly ian: Principal;
  readonly harnessId: string;
  readonly check: Stage;
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function raceOn(connections: Connections): Promise<Race> {
  const ian = await personOn(connections.gate, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const harnessId = crypto.randomUUID();
  const { stages } = accepted(
    await kernelOn(connections.gate, clock).stages.activate(caller(ian), {
      harnessId,
      harnessKey: 'software',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-platform',
    }),
    'activate',
  );
  const check = stages.find((stage) => stage.key === 'check');
  if (check === undefined) throw new Error('no check stage');
  return { connections, ian, harnessId, check };
}

async function withRace(work: (race: Race) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    gate: createClient(database.connectionString),
    wip: createClient(database.connectionString),
    holder: createClient(database.connectionString),
    observer: createClient(database.connectionString),
  };
  try {
    await work(await raceOn(connections));
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

function edit(race: Race, db: Database, change: Partial<Stage>) {
  return kernelOn(db, clock).stages.updateStage(caller(race.ian), {
    harnessId: race.harnessId,
    stageKey: 'check',
    change,
  });
}

async function editsBehindARowLock(race: Race) {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  let locked = (): void => undefined;
  const rowLocked = new Promise<void>((resolve) => void (locked = resolve));
  const holding = race.connections.holder.$client.begin(async (sql) => {
    await sql`SELECT id FROM harness_stages WHERE id = ${race.check.id} FOR UPDATE`;
    locked();
    await released;
  });
  await rowLocked;
  const gate = edit(race, race.connections.gate, { exitGate: 'human_approval' });
  const wip = edit(race, race.connections.wip, { wipLimit: 1 });
  await awaitBlocked(async () => ((await lockWaiters(race.connections.observer)) >= 2 ? 1 : 0));
  release();
  await holding;
  return Promise.all([gate, wip]);
}

async function storedCheck(race: Race) {
  const rows = await race.connections.observer.$client`
    SELECT exit_gate, wip_limit FROM harness_stages WHERE id = ${race.check.id}`;
  return rows[0];
}

async function bothChangesSurvive(race: Race): Promise<void> {
  const outcomes = await editsBehindARowLock(race);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(['accepted', 'accepted']);
  expect(await storedCheck(race)).toEqual({ exit_gate: 'human_approval', wip_limit: 1 });
}

describe.skipIf(!testServer)(
  'KN-18 DX-6 two stage edits on one harness, on real connections',
  () => {
    it('keeps both changes when one raises the gate and the other lowers the WIP limit', () =>
      withRace(bothChangesSurvive));
  },
);

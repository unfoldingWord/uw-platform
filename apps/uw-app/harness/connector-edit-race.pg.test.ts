import type { Principal, Stage } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { software, type Caller, type Clock, type KernelOutcome } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const instant = new Date();
const clock: Clock = { now: () => instant };

type Connections = {
  readonly editor: Database;
  readonly holder: Database;
  readonly observer: Database;
};

type Race = {
  readonly connections: Connections;
  readonly ian: Principal;
  readonly harnessId: string;
  readonly ship: Stage;
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function raceOn(connections: Connections): Promise<Race> {
  const { editor } = connections;
  const ian = await personOn(editor, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const harnessId = crypto.randomUUID();
  const { stages } = accepted(
    await kernelOn(editor, clock).stages.activate(caller(ian), {
      harnessId,
      harnessKey: 'software',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-platform',
    }),
    'activate',
  );
  const ship = stages.find((stage) => stage.key === 'ship');
  if (ship === undefined) throw new Error('no ship stage');
  return { connections, ian, harnessId, ship };
}

async function withRace(work: (race: Race) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    editor: createClient(database.connectionString),
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

async function editWhileADecisionHoldsTheStage(race: Race) {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  let locked = (): void => undefined;
  const stageLocked = new Promise<void>((resolve) => void (locked = resolve));
  const key = `harness-stage-claims:${race.ship.id}`;
  const holding = race.connections.holder.$client.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    locked();
    await released;
  });
  await stageLocked;
  const edit = kernelOn(race.connections.editor, clock).stages.updateStage(caller(race.ian), {
    harnessId: race.harnessId,
    stageKey: 'ship',
    change: { connector: 'none', exitGate: 'checks' },
  });
  await awaitBlocked(() => lockWaiters(race.connections.observer));
  release();
  await holding;
  return edit;
}

describe.skipIf(!testServer)(
  'KN-18 DX-6 a connector edit and a gate decision on one stage, on real connections',
  () => {
    it('waits on the stage-claims lock a gate decision holds', () =>
      withRace(async (race) => {
        const outcome = await editWhileADecisionHoldsTheStage(race);
        expect(outcome.status).toBe('accepted');
      }));
  },
);

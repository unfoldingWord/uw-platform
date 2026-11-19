import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import type { Clock } from '@uw/harness';
import { queryCounter, type DatabaseStats } from '../database.ts';
import {
  activatedHarness,
  advanced,
  boardWorld,
  enqueuedItem,
  type BoardWorld,
} from '../testing/board-world.ts';
import { kernelOn } from '../testing/kernel.ts';
import { getHtml } from '../testing/views.ts';
import {
  agentQueuesPath,
  agentsPath,
  controlsPath,
  flowPath,
  gatePath,
  healthPath,
  homePath,
  itemPath,
  queuePath,
  runPath,
  runsPath,
  waitingPath,
} from './parts/paths.ts';

const QUERY_BUDGET = 40;
const TRANSACTION_BUDGET = 1;

const seedClock: Clock = { now: () => new Date('2026-10-02T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };

type Counted = { readonly db: Database; readonly stats: () => DatabaseStats };

function pagesOf(world: BoardWorld): Readonly<Record<string, string>> {
  const { harnessId } = world;
  return {
    today: homePath(),
    agentQueues: agentQueuesPath(),
    flow: flowPath(harnessId),
    queue: queuePath(harnessId),
    waiting: waitingPath(harnessId),
    runs: runsPath(harnessId),
    run: runPath(harnessId, world.meteredRunId),
    controls: controlsPath(harnessId),
    agents: agentsPath(harnessId),
    health: healthPath(),
    gate: gatePath(harnessId, world.personHeld),
    item: itemPath(harnessId, world.metered),
    events: `/api/harness/${harnessId}/events?after=0`,
  };
}

async function grown(world: BoardWorld): Promise<void> {
  const kernel = kernelOn(world.db, seedClock);
  for (const key of ['software-two', 'software-three']) {
    const harnessId = await activatedHarness(kernel, world.rowan, undefined, key);
    for (const title of ['First', 'Second', 'Third']) {
      const itemId = await enqueuedItem(kernel, world.rowan, harnessId, `${key} ${title}`);
      await advanced(kernel, world.rowan, itemId, 2);
    }
  }
  for (const title of ['Fourth', 'Fifth', 'Sixth']) {
    const itemId = await enqueuedItem(kernel, world.rowan, world.harnessId, title);
    await advanced(kernel, world.rowan, itemId, 1);
  }
}

async function measured(
  counted: Counted,
  world: BoardWorld,
): Promise<Readonly<Record<string, DatabaseStats>>> {
  const seen: Record<string, DatabaseStats> = {};
  for (const [name, path] of Object.entries(pagesOf(world))) {
    const before = counted.stats();
    const page = await getHtml(counted.db, world.rowanEmail, path, {}, viewClock);
    expect(page.status, name).toBeLessThan(500);
    const after = counted.stats();
    seen[name] = {
      queries: after.queries - before.queries,
      transactions: after.transactions - before.transactions,
    };
  }
  return seen;
}

async function withCountedDatabase(work: (counted: Counted) => Promise<void>): Promise<void> {
  await withMigratedDatabase(testServer ?? '', async (target) => {
    const counter = queryCounter();
    const db = createClient(target, counter.count);
    try {
      await work({ db, stats: counter.stats });
    } finally {
      await db.$client.end();
    }
  });
}

describe.skipIf(testServer === undefined)('the database cost of a page', () => {
  it('stays inside the budget and does not grow with more workflows and items', async () => {
    await withCountedDatabase(async (counted) => {
      const world = await boardWorld(counted.db, seedClock);
      const small = await measured(counted, world);
      await grown(world);
      const large = await measured(counted, world);
      for (const [name, cost] of Object.entries(large)) {
        expect({ name, ...cost }).toEqual({ name, ...small[name] });
        expect(cost.queries, name).toBeLessThanOrEqual(QUERY_BUDGET);
        expect(cost.transactions, name).toBeLessThanOrEqual(TRANSACTION_BUDGET);
      }
    });
  }, 120_000);
});

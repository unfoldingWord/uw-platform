import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { migrationTimestamps } from '@uw/db/journal';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import type { Hub } from '@uw/harness';
import { hubWiring, platformKernel } from './kernel.ts';
import { hubNotWired } from './ports/hub.not-wired.ts';
import { callerOf, ian, softwareHarness } from './testing/commands.ts';
import { withAppDatabase } from './testing/postgres.ts';

const clock = { now: () => new Date() };

function handleOn(db: Database) {
  return { db, ping: async () => undefined, release: async () => undefined };
}

async function enqueueWith(db: Database, harnessId: string, hub: Hub) {
  const kernel = platformKernel(handleOn(db), clock, hubWiring(hub));
  return kernel.items.enqueue(callerOf(await ian(db)), {
    harnessId,
    title: 'Draw the board',
    pageId: null,
    priority: 0,
    due: null,
    delegationId: null,
  });
}

async function wakesTheWiredHub(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const woken: string[] = [];
  const outcome = await enqueueWith(db, scene.harnessId, {
    wake: async (harnessId) => void woken.push(harnessId),
    present: async () => false,
  });
  expect(outcome.status).toBe('accepted');
  expect(woken).toEqual([scene.harnessId]);
}

async function succeedsWithoutAHub(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const outcome = await enqueueWith(db, scene.harnessId, hubNotWired);
  expect(outcome.status).toBe('accepted');
}

describe.skipIf(!testServer)('WB-3 a platform kernel wakes the hub it is wired with', () => {
  it('wakes the wired hub for the harness a command appended to', () =>
    withAppDatabase(wakesTheWiredHub));

  it('accepts the command when the hub is not wired', () => withAppDatabase(succeedsWithoutAHub));
});

describe.skipIf(!testServer)('DX-1 the platform kernel on Postgres', () => {
  it('reads health from the platform clock and the Drizzle store', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        const handle = { db, ping: async () => undefined, release: async () => undefined };
        const health = await platformKernel(handle).health();
        expect(health.appliedMigrations).toEqual(migrationTimestamps);
        expect(Math.abs(health.now.getTime() - Date.now())).toBeLessThan(5000);
      } finally {
        await db.$client.end();
      }
    }));
});

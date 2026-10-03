import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Outcome } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { claimRequest, priorRequest, settleRequest } from '../commands/requests.ts';
import { testServer } from '../testing/postgres.ts';
import type { CronDeps } from './job.ts';
import { pruneRequestsJob } from './request-retention.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-03T03:17:00.000Z');
const actor = 'human:00000000-0000-4000-8000-000000000001';

type Line = Record<string, unknown>;

function deps(lines: Line[]): CronDeps {
  return {
    now: () => now,
    fetch: () => Promise.reject(new Error('the retention sends no request')),
    sink: (line) => lines.push(JSON.parse(line) as Line),
    newId: () => randomUUID(),
    commit: 'c',
    engines: { fetch: () => Promise.reject(new Error('the retention reads no spend')) },
  };
}

async function request(db: Database, daysAgo: number, settled: boolean): Promise<string> {
  const requestId = randomUUID();
  const key = { actor, requestId };
  const at = new Date(now.getTime() - daysAgo * DAY);
  const traceId = randomUUID();
  const claim = { command: 'enqueue' as const, harnessId: randomUUID(), traceId, at };
  expect(await claimRequest(db, key, claim)).toBe(true);
  if (settled) {
    const outcome: Outcome = { status: 'accepted', requestId };
    await settleRequest(db, key, { outcome, traceId, at });
  }
  return requestId;
}

async function kinds(db: Database, ids: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const requestId of ids) found.push((await priorRequest(db, { actor, requestId })).kind);
  return found;
}

async function prunesOldRequests(): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    const old = [await request(db, 31, true), await request(db, 31, false)];
    const kept = [await request(db, 29, true), await request(db, 29, false)];
    const lines: Line[] = [];
    const env = { HYPERDRIVE: { connectionString: database.connectionString } };
    await pruneRequestsJob(env, deps(lines));
    expect(await kinds(db, old)).toEqual(['none', 'none']);
    expect(await kinds(db, kept)).toEqual(['settled', 'pending']);
    expect(lines).toEqual([
      expect.objectContaining({
        outcome: 'pruned',
        deleted: 2,
        principal: 'agent:system',
        route: 'cron request retention',
      }),
    ]);
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

describe.skipIf(!testServer)('the command request retention', () => {
  it('deletes requests settled, or claimed and never settled, more than 30 days ago, and keeps the rest', () =>
    prunesOldRequests());
});

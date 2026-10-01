import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { postgresWatermarks } from '../queue/watermarks.ts';
import { recordingDeps } from '../testing/deps.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const enqueuedAt = new Date('2026-10-01T12:00:00.000Z');

async function report(db: Database, withQueue: boolean) {
  const { deps } = recordingDeps();
  const handle = {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    release: async () => undefined,
  };
  const env = withQueue ? { INGEST_DLQ: { send: async () => undefined } } : {};
  const response = await createApp({ ...deps, openDatabase: () => handle }).request(
    '/health',
    {},
    env,
  );
  return healthReportSchema.parse(await response.json());
}

function named(indicators: readonly HealthIndicator[], name: string): HealthIndicator {
  const found = indicators.find((indicator) => indicator.name === name);
  if (!found) throw new Error(`no indicator ${name}`);
  return found;
}

async function lagReport(db: Database, seconds: number) {
  const consumedAt = new Date(enqueuedAt.getTime() + seconds * 1000);
  await postgresWatermarks(db).record('ingest', enqueuedAt, consumedAt);
  return report(db, true);
}

describe.skipIf(!testServer)('FD-11 database and queue indicators against Postgres', () => {
  it('reports a reachable database and a queue with nothing consumed', () =>
    withAppDatabase(async (db) => {
      const result = await report(db, true);
      expect(named(result.indicators, 'database').status).toBe('ok');
      expect(named(result.indicators, 'database').detail).toMatch(/^reachable in \d+ ms$/);
      expect(named(result.indicators, 'queue')).toMatchObject({
        status: 'ok',
        detail: 'no messages consumed yet',
      });
    }));

  it('reports consumer lag as ok, amber and red by seconds', async () => {
    const cases = [
      [10, 'ok', 'ok'],
      [120, 'amber', 'amber'],
      [400, 'red', 'red'],
    ] as const;
    for (const [seconds, status, overall] of cases) {
      await withAppDatabase(async (db) => {
        const result = await lagReport(db, seconds);
        expect(named(result.indicators, 'queue')).toMatchObject({
          status,
          detail: `consumer lag ${seconds} s`,
        });
        expect(result.status).toBe(overall);
      });
    }
  });
});

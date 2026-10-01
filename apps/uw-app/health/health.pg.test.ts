import { sql } from 'drizzle-orm';
import { createServer, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { DATABASE_TIMEOUT_MS } from './indicators.ts';
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

function listenSilently(): Promise<Server> {
  const server = createServer();
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function portOf(server: Server): number {
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

async function stalledReport(): Promise<{ elapsed: number; indicators: HealthIndicator[] }> {
  const server = await listenSilently();
  const db = createClient(`postgres://u@127.0.0.1:${portOf(server)}/d`);
  const handle = {
    db,
    ping: () => new Promise<void>(() => undefined),
    release: async () => undefined,
  };
  const { deps } = recordingDeps();
  const env = { INGEST_DLQ: { send: async () => undefined } };
  const started = Date.now();
  try {
    const response = await createApp({ ...deps, openDatabase: () => handle }).request(
      '/health',
      {},
      env,
    );
    expect(response.status).toBe(200);
    return {
      elapsed: Date.now() - started,
      indicators: healthReportSchema.parse(await response.json()).indicators,
    };
  } finally {
    await db.$client.end({ timeout: 0 });
    server.close();
  }
}

describe('FD-11 a database that accepts connections and never answers', () => {
  it('answers 200 within the timeout with the database and queue red', async () => {
    const { elapsed, indicators } = await stalledReport();
    expect(elapsed).toBeLessThan(DATABASE_TIMEOUT_MS + 1000);
    expect(named(indicators, 'database').status).toBe('red');
    expect(named(indicators, 'queue')).toMatchObject({
      status: 'red',
      detail: 'watermark unreadable',
    });
  });
});

describe.skipIf(!testServer)('FD-11 database and queue indicators against Postgres', () => {
  it('reports a reachable database and a queue with nothing consumed', () =>
    withAppDatabase(async (db) => {
      const result = await report(db, true);
      expect(named(result.indicators, 'database').detail).toMatch(/^reachable in \d+ ms$/);
      expect(named(result.indicators, 'queue')).toMatchObject({
        status: 'ok',
        detail: 'no messages consumed yet',
      });
    }));

  it('reports consumer lag as ok, amber and red by seconds', async () => {
    const cases = [
      [10, 'ok'],
      [120, 'amber'],
      [400, 'red'],
    ] as const;
    for (const [seconds, status] of cases) {
      await withAppDatabase(async (db) => {
        const result = await lagReport(db, seconds);
        expect(named(result.indicators, 'queue')).toMatchObject({
          status,
          detail: `consumer lag ${seconds} s`,
        });
        if (status === 'red') expect(result.status).toBe('red');
      });
    }
  });
});

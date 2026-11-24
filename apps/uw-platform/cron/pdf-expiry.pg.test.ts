import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { bucketFiles } from '../pages/file-store.ts';
import { exportLifetimeDays, storeReadyExport } from '../pdf/exports.ts';
import { memoryBucket } from '../testing/files.ts';
import { testServer } from '../testing/postgres.ts';
import type { CronDeps } from './job.ts';
import { expirePdfExportsJob } from './pdf-expiry.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-24T03:17:00.000Z');
const HASH = 'b'.repeat(64);

type Line = Record<string, unknown>;

const agent: Principal = principalSchema.parse({
  identity: 'agent:exporter',
  kind: 'agent',
  personId: null,
  email: null,
  grants: [],
  interactive: false,
});

function deps(lines: Line[]): CronDeps {
  return {
    now: () => now,
    fetch: () => Promise.reject(new Error('the expiry sends no request')),
    sink: (line) => lines.push(JSON.parse(line) as Line),
    newId: () => randomUUID(),
    commit: 'c',
    engines: { fetch: () => Promise.reject(new Error('the expiry reads no spend')) },
  };
}

function exported(daysAgo: number) {
  return {
    kind: 'page' as const,
    title: 'A page',
    reference: '00-09/a-page@v1',
    areas: ['00-09'],
    request: { kind: 'page', pageId: randomUUID() },
    actor: agent,
    at: new Date(now.getTime() - daysAgo * DAY),
    pdf: new TextEncoder().encode('%PDF-1.7\n'),
    sha256: HASH,
  };
}

async function expiresLapsedExports(): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    const bucket = memoryBucket();
    const files = bucketFiles(bucket);
    const lapsed = await storeReadyExport(db, files, exported(exportLifetimeDays + 1));
    const kept = await storeReadyExport(db, files, exported(1));
    const lines: Line[] = [];
    const env = { HYPERDRIVE: { connectionString: database.connectionString }, FILES: bucket };
    await expirePdfExportsJob(env, deps(lines));
    expect(await files.get(`exports/${lapsed.exportId}.pdf`)).toBeNull();
    expect(await files.get(`exports/${kept.exportId}.pdf`)).not.toBeNull();
    expect(lines).toEqual([
      expect.objectContaining({ outcome: 'expired', expired: 1, route: 'cron pdf export expiry' }),
    ]);
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

async function skipsWithoutTheBucket(): Promise<void> {
  const lines: Line[] = [];
  const env = { HYPERDRIVE: { connectionString: 'postgres://cron@127.0.0.1:1/none' } };
  await expirePdfExportsJob(env, deps(lines));
  expect(lines).toEqual([expect.objectContaining({ outcome: 'not_wired' })]);
}

describe.skipIf(!testServer)('#198 the nightly PDF export expiry', () => {
  it('#198 deletes the files of exports past their lifetime and logs how many', () =>
    expiresLapsedExports());
  it('#198 logs not_wired and touches nothing when the bucket is not bound', () =>
    skipsWithoutTheBucket());
});

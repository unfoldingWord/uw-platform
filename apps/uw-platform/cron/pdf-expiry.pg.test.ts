import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import { bucketFiles } from '../pages/file-store.ts';
import { exportLifetimeDays, queueExport, readExport, storeReadyExport } from '../pdf/exports.ts';
import { memoryBucket } from '../testing/files.ts';
import { testServer } from '../testing/postgres.ts';
import type { CronDeps } from './job.ts';
import { expirePdfExportsJob } from './pdf-expiry.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-24T03:17:00.000Z');
const HASH = 'b'.repeat(64);
const OWNER_ID = randomUUID();

type Line = Record<string, unknown>;

const owner: Principal = principalSchema.parse({
  identity: `agent:${OWNER_ID}/laptop`,
  kind: 'agent',
  personId: OWNER_ID,
  email: null,
  grants: [
    {
      grantId: randomUUID(),
      role: 'viewer',
      scopeKind: 'jd_area',
      scopeArea: '00-09',
      expiresAt: null,
    },
  ],
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
    actor: owner,
    at: new Date(now.getTime() - daysAgo * DAY),
    pdf: new TextEncoder().encode('%PDF-1.7\n'),
    sourceSha256: HASH,
    channel: 'platform' as const,
    stories: [],
  };
}

async function expiresLapsedExports(): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    await seedPerson(db, { id: OWNER_ID, email: 'exporter@unfoldingword.org' });
    const bucket = memoryBucket();
    const files = bucketFiles(bucket);
    const lapsed = await storeReadyExport(db, files, exported(exportLifetimeDays + 1));
    const kept = await storeReadyExport(db, files, exported(1));
    const stuck = await queueExport(db, { ...exported(1), kind: 'binder' });
    const lines: Line[] = [];
    const env = { HYPERDRIVE: { connectionString: database.connectionString }, FILES: bucket };
    await expirePdfExportsJob(env, deps(lines));
    expect(await files.get(`exports/${lapsed.exportId}.pdf`)).toBeNull();
    expect(await files.get(`exports/${kept.exportId}.pdf`)).not.toBeNull();
    expect(await readExport(db, owner, stuck.exportId, now)).toMatchObject({
      status: 'failed',
      failure: 'internal_error',
    });
    expect(lines).toEqual([
      expect.objectContaining({
        outcome: 'expired',
        expired: 1,
        stuck: 1,
        route: 'cron pdf export expiry',
      }),
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

import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { directMessagesOf } from '../assistants/direct-messages.ts';
import { saveMeasure } from '../measures/authoring.ts';
import { latestRunOf } from '../measures/runs.ts';
import { collectionsAt } from '../testing/collections.ts';
import { memoryBucket } from '../testing/files.ts';
import {
  agentOf,
  FIRST_DUE,
  forceActive,
  geoMeasure,
  heldRuns,
  MEASURE_AREA,
  measureWorld,
  newId,
} from '../testing/measure-world.ts';
import { testServer } from '../testing/postgres.ts';
import type { CronDeps } from './job.ts';
import { expireMeasureRawJob, startDueMeasures } from './measures.ts';

type Line = Record<string, unknown>;

function deps(lines: Line[], at: Date = collectionsAt): CronDeps {
  return {
    now: () => at,
    fetch: () => Promise.reject(new Error('the measures job sends no request')),
    sink: (line) => lines.push(JSON.parse(line) as Line),
    newId: () => newId(),
    commit: 'c',
    engines: { fetch: () => Promise.reject(new Error('the measures job reads no spend')) },
    directMessages: directMessagesOf,
  };
}

async function withDatabase(work: (db: Database, url: string) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    await work(db, database.connectionString);
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

async function dueMeasure(db: Database): Promise<string> {
  const world = await measureWorld(db);
  const measureId = newId();
  await saveMeasure(
    { db, actor: agentOf(world.admin), traceId: newId(), at: collectionsAt },
    {
      measureId,
      expectedVersion: null,
      jdArea: MEASURE_AREA,
      title: 'GEO score',
      slug: 'geo-score',
      bodyMd: '',
      measure: geoMeasure(),
    },
  );
  await forceActive(world, measureId);
  return measureId;
}

async function startsDueMeasures(db: Database): Promise<void> {
  const measureId = await dueMeasure(db);
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const lines: Line[] = [];
  const log = createLogger(
    { traceId: newId(), commit: 'c', route: 'cron minute', principal: null },
    (line) => lines.push(JSON.parse(line) as Line),
  );
  await startDueMeasures(handle, {}, deps([], FIRST_DUE), log);
  expect(await latestRunOf(db, measureId)).toMatchObject({ kind: 'trial' });
  const binding = heldRuns();
  await startDueMeasures(handle, { MEASURE_RUN: binding }, deps([], FIRST_DUE), log);
  expect(lines.map((line) => line['outcome'])).toEqual([
    'runs_stalled',
    'not_wired',
    'runs_stalled',
    'runs_started',
  ]);
  expect(binding.started).toHaveLength(1);
  expect(await latestRunOf(db, measureId)).toMatchObject({ kind: 'scheduled', state: 'queued' });
  const hoursLater = new Date(FIRST_DUE.getTime() + 2 * 3_600_000);
  await startDueMeasures(handle, { MEASURE_RUN: binding }, deps([], hoursLater), log);
  expect(lines.at(-2)).toMatchObject({ outcome: 'runs_stalled', stalled: 1 });
  expect(await latestRunOf(db, measureId)).toMatchObject({ kind: 'scheduled', state: 'stalled' });
}

async function logsNightlyExpiry(_db: Database, connectionString: string): Promise<void> {
  const lines: Line[] = [];
  await expireMeasureRawJob({ HYPERDRIVE: { connectionString } }, deps(lines));
  const env = { HYPERDRIVE: { connectionString }, FILES: memoryBucket() };
  await expireMeasureRawJob(env, deps(lines));
  expect(lines.map((line) => [line['route'], line['outcome']])).toEqual([
    ['cron measure output expiry', 'not_wired'],
    ['cron measure output expiry', 'expired'],
  ]);
  expect(lines[1]).toMatchObject({ expired: 0 });
}

describe.skipIf(!testServer)('the cron runs measures and expires their raw output', () => {
  it('starts the due measures from the minute job, or says the run binding is not wired', () =>
    withDatabase(startsDueMeasures));

  it('logs the nightly expiry, and skips it without a file bucket', () =>
    withDatabase(logsNightlyExpiry));
});

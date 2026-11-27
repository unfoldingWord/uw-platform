import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { day, observe, readWorld, type ReadWorld } from '../testing/measure-reads.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { seriesOf } from './observation-reads.ts';

const FREQUENT_RUNS = 20_001;
const TREND_POINTS = 400;

async function measureOften(world: ReadWorld, seedRun: string): Promise<void> {
  await world.db.execute(sql`
    WITH runs AS (
      INSERT INTO measure_runs
        (id, measure_page_id, measure_version, tool_hash, kind, requested_by, state, area,
         created_at, finished_at)
      SELECT gen_random_uuid(), measure_page_id, measure_version, tool_hash, kind, requested_by,
             'ok', area, created_at + n * interval '1 minute', created_at + n * interval '1 minute'
      FROM measure_runs, generate_series(1, ${FREQUENT_RUNS}) AS n
      WHERE id = ${seedRun}
      RETURNING id, created_at
    )
    INSERT INTO observations
      (id, run_id, measure_page_id, measure_version, resource_page_id, observed_at,
       tool_version, values, outcome, area)
    SELECT gen_random_uuid(), runs.id, ${world.measureId}, 1, ${world.sites.door43},
           runs.created_at, '4.19.10', '{"score": 50, "band": "good", "fixes": []}'::jsonb,
           'ok', '00-09'
    FROM runs`);
}

async function keepsEachResourceLatest(db: Database): Promise<void> {
  const world = await readWorld(db);
  const { door43, uw } = world.sites;
  await observe(world, { kind: 'scheduled', at: day(1) }, new Map([[uw, { score: 70 }]]));
  const seedRun = await observe(
    world,
    { kind: 'scheduled', at: day(2) },
    new Map([[door43, { score: 40 }]]),
  );
  await measureOften(world, seedRun);
  const series = await seriesOf(db, world.measureId, {
    resourceIds: [door43, uw],
    trials: false,
  });
  expect(series.get(uw)?.map((row) => row.values?.['score'])).toEqual([70]);
  const frequent = series.get(door43) ?? [];
  expect(frequent).toHaveLength(TREND_POINTS);
  const times = frequent.map((row) => row.observedAt.getTime());
  expect(times).toEqual([...times].sort((a, b) => a - b));
  expect(frequent.at(-1)?.observedAt.getTime()).toBe(day(2).getTime() + FREQUENT_RUNS * 60_000);
}

describe.skipIf(!testServer)(
  'ADR 0036 a series keeps the latest observations of each resource',
  () => {
    it('keeps a seldom measured resource when another fills the history', () =>
      withAppDatabase(keepsEachResourceLatest));
  },
);

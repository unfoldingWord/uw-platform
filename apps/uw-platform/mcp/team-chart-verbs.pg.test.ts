import { describe, expect, it } from 'vitest';
import { renderedChartSchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { measureApp } from '../testing/measure-app.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { teamWorld, type TeamWorld } from '../testing/team.ts';

async function inWorld(work: (world: TeamWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await teamWorld(db)));
}

const network = { chart: 'commitments_network', params: {}, spec: null };

async function agentReadsNoPersonRecord(world: TeamWorld): Promise<void> {
  const called = await measureApp(world.db, {}).verb(world.steward.email, 'render_chart', network);
  expect(called.isError).toBe(false);
  const rendered = renderedChartSchema.parse(called.body);
  expect(rendered.table.rows).toEqual([]);
  expect(rendered.lineage.excluded).toEqual({
    count: 6,
    reasons: [{ reason: 'person_not_readable', count: 6 }],
    entries: [],
  });
  expect(rendered.svg).not.toMatch(/Ada Example|Sam Sample|Lee-Anne Placeholder/);
}

async function refusesAnOutsider(world: TeamWorld): Promise<void> {
  const called = await measureApp(world.db, {}).verb(world.outsider.email, 'render_chart', network);
  expect(called.isError).toBe(true);
  expect(called.body).toMatchObject({ reason: 'not_permitted' });
}

describe.skipIf(!testServer)('#200 render_chart draws a team chart on the directory’s area', () => {
  it('#200 an agent reads no person record, so its team chart counts every entry as unreadable and names no one', () =>
    inWorld(agentReadsNoPersonRecord));
  it('#200 an agent whose person cannot read the directory is refused', () =>
    inWorld(refusesAnOutsider));
});

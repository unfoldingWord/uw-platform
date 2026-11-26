import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { renderedChartSchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, getWithBindings } from '../testing/views.ts';
import { chartFilePath, chartPath, chartsPath } from './parts/paths.ts';

const clock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };

async function inWorld(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, clock)));
}

async function screenOf(world: BoardWorld, path: string, email = world.rowanEmail) {
  const page = await getHtml(world.db, email, path, {}, clock);
  return { page, document: new JSDOM(page.text).window.document };
}

async function drawsWithItsRows(world: BoardWorld): Promise<void> {
  const { page, document } = await screenOf(world, chartPath('burndown', world.harnessId));
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  expect(document.querySelector('main [data-shape="overview"] h1')?.textContent).toBe('Burndown');
  const svg = document.querySelector('main section[aria-labelledby="chart-heading"] svg');
  expect(svg?.getAttribute('role')).toBe('img');
  expect(svg?.querySelector('title')?.textContent).toBe('Open items');
  const file = await getWithBindings(
    world.db,
    world.rowanEmail,
    chartFilePath('burndown', world.harnessId, 'json'),
    {},
    clock,
  );
  const rendered = renderedChartSchema.parse(JSON.parse(new TextDecoder().decode(file.bytes)));
  const rows = document.querySelectorAll('section[aria-labelledby="chart-rows-heading"] tbody tr');
  expect(rows).toHaveLength(rendered.table.rows.length);
  const links = [...document.querySelectorAll('main a[href^="/api/charts/"]')].map((a) =>
    a.getAttribute('href'),
  );
  expect(links).toEqual(
    (['svg', 'png', 'csv', 'json'] as const).map((format) =>
      chartFilePath('burndown', world.harnessId, format),
    ),
  );
}

async function staleInPlace(world: BoardWorld): Promise<void> {
  await world.db.execute(
    sql`INSERT INTO webhook_deliveries (source, delivery_id, received_at) VALUES ('github', 'screen-late', '2026-10-02T08:00:00.000Z'::timestamptz)`,
  );
  const { document } = await screenOf(world, chartPath('cumulative_flow', world.harnessId));
  const note = document.querySelector('section[aria-labelledby="chart-heading"] [role="note"]');
  expect(note?.textContent).toMatch(/^Source behind since 2026-10-02 08:00 UTC/);
}

async function listsAndPicks(world: BoardWorld): Promise<void> {
  const list = await screenOf(world, chartsPath());
  expect(await screenProblems(list.page.text)).toEqual([]);
  const names = [...list.document.querySelectorAll('main tbody a')].map((a) => a.textContent);
  expect(names).toEqual([
    'Runs Over Time',
    'Gate Waits Over Time',
    'Cumulative Flow',
    'Cycle Time',
    'Burndown',
  ]);
  const pick = await screenOf(world, chartPath('cycle_time'));
  expect(await screenProblems(pick.page.text)).toEqual([]);
  const picked = pick.document.querySelector('main tbody a')?.getAttribute('href');
  expect(picked).toBe(chartPath('cycle_time', world.harnessId));
}

async function strangerAndNonsense(world: BoardWorld): Promise<void> {
  const stranger = await screenOf(
    world,
    chartPath('burndown', world.harnessId),
    world.stranger.email,
  );
  expect(stranger.page.status).toBe(404);
  expect((await screenOf(world, chartPath('budget', world.harnessId))).page.status).toBe(404);
  expect((await screenOf(world, '/charts/burndown?harnessId=nope')).page.status).toBe(404);
}

describe.skipIf(!testServer)('#199 the chart screens', () => {
  it('#199 a standard chart draws in the Overview shape with the table of exactly its rows and its downloads', () =>
    inWorld(drawsWithItsRows));
  it('#199 a chart over a stale source shows its staleness note in place', () =>
    inWorld(staleInPlace));
  it('#199 the Charts screen lists the standard set, and a chart without a workflow asks for one', () =>
    inWorld(listsAndPicks));
  it('#199 a person who cannot read the workflow, an unknown chart or a bad id gets not found', () =>
    inWorld(strangerAndNonsense));
});

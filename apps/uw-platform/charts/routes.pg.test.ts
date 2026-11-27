import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { renderedChartSchema, type RenderedChart } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { postJson } from '../testing/chart-app.ts';
import { csvRows } from '../testing/csv.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getWithBindings } from '../testing/views.ts';
import { chartFilePath, type ChartFileFormat } from '../views/parts/paths.ts';

const clock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };
const MINUTE = 60_000;
const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function inWorld(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, clock)));
}

function fetchChart(
  world: BoardWorld,
  format: ChartFileFormat,
  options: {
    readonly email?: string;
    readonly env?: Record<string, unknown>;
    readonly key?: string;
  } = {},
) {
  const path = chartFilePath(options.key ?? 'cumulative_flow', world.harnessId, format);
  return getWithBindings(
    world.db,
    options.email ?? world.rowanEmail,
    path,
    options.env ?? {},
    clock,
  );
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

async function jsonOf(world: BoardWorld, key = 'cumulative_flow'): Promise<RenderedChart> {
  const fetched = await fetchChart(world, 'json', { key });
  expect(fetched.status).toBe(200);
  return renderedChartSchema.parse(JSON.parse(text(fetched.bytes)));
}

async function waitingDelivery(db: Database, minutes: number): Promise<void> {
  const received = new Date(clock.now().getTime() - minutes * MINUTE).toISOString();
  await db.execute(
    sql`INSERT INTO webhook_deliveries (source, delivery_id, received_at) VALUES ('github', 'charts-late', ${received}::timestamptz)`,
  );
}

async function csvEqualsRows(world: BoardWorld): Promise<void> {
  for (const key of ['cumulative_flow', 'cycle_time', 'burndown', 'runs_over_time']) {
    const rendered = await jsonOf(world, key);
    const csv = await fetchChart(world, 'csv', { key });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain(`${key}-2026-10-02.csv`);
    expect(csvRows(text(csv.bytes))).toEqual([
      rendered.table.columns.map((column) => column.label),
      ...rendered.table.rows.map((row) =>
        rendered.table.columns.map((column) => String(row[column.key] ?? '')),
      ),
    ]);
  }
}

async function flowFromTheLog(world: BoardWorld): Promise<void> {
  const rendered = await jsonOf(world);
  const today = rendered.table.rows.filter((row) => row['day'] === '2026-10-02');
  const total = today.reduce((sum, row) => sum + Number(row['items']), 0);
  expect(total).toBe(4);
  expect(today.at(-1)).toMatchObject({ stage: 'Done' });
  expect(rendered.lineage).toMatchObject({
    query: 'item_cumulative_flow',
    asOf: clock.now().toISOString(),
    filters: { harnessId: world.harnessId },
    excluded: { count: 0, reasons: [] },
    stale: null,
  });
}

async function svgStandsAlone(world: BoardWorld): Promise<void> {
  const fetched = await fetchChart(world, 'svg');
  expect(fetched.status).toBe(200);
  expect(fetched.headers.get('content-type')).toContain('image/svg+xml');
  const svg = text(fetched.bytes);
  expect(svg).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?><\?xml-stylesheet [^>]*\?><svg/);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).not.toMatch(/<style\b|\sstyle="|<script\b/);
}

async function staleNote(world: BoardWorld): Promise<void> {
  await waitingDelivery(world.db, 20);
  const rendered = await jsonOf(world, 'runs_over_time');
  expect(rendered.lineage.stale).toEqual({
    since: '2026-10-02T08:40:00.000Z',
    reason: 'source_behind',
  });
  expect(rendered.svg).toContain('Source behind since 2026-10-02 08:40 UTC');
}

async function freshWithinFiveMinutes(world: BoardWorld): Promise<void> {
  await waitingDelivery(world.db, 2);
  expect((await jsonOf(world, 'runs_over_time')).lineage.stale).toBeNull();
}

async function offTheWhitelist(world: BoardWorld): Promise<void> {
  const spec = {
    title: 'Every gift',
    type: 'bar',
    query: { key: 'all_gifts', params: { harnessId: world.harnessId } },
    encodings: { x: 'day', y: ['amount'], series: null },
    format: { x: 'date', y: 'count', currency: null },
  };
  const refused = await postJson(world.db, world.rowanEmail, '/api/charts/render', spec, clock);
  expect(refused).toEqual({
    status: 422,
    body: { status: 'error', reason: 'chart_query_not_allowed' },
  });
  const allowed = {
    ...spec,
    query: { key: 'item_burndown', params: { harnessId: world.harnessId } },
    encodings: { x: 'day', y: ['open'], series: null },
  };
  const drawn = await postJson(world.db, world.rowanEmail, '/api/charts/render', allowed, clock);
  expect(drawn.status).toBe(200);
  expect(renderedChartSchema.safeParse(drawn.body).success).toBe(true);
  const unknown = await getWithBindings(
    world.db,
    world.rowanEmail,
    '/api/charts/all_gifts',
    {},
    clock,
  );
  expect(JSON.parse(text(unknown.bytes))).toEqual({
    status: 'error',
    reason: 'chart_query_not_allowed',
  });
}

async function strangerSeesNothing(world: BoardWorld): Promise<void> {
  const fetched = await fetchChart(world, 'csv', { email: world.stranger.email });
  expect(fetched.status).toBe(404);
  expect(JSON.parse(text(fetched.bytes))).toEqual({ status: 'error', reason: 'harness_not_found' });
  expect((await fetchChart(world, 'json', { email: world.viewer.email })).status).toBe(200);
}

async function pngThroughTheBrowser(world: BoardWorld): Promise<void> {
  const browser = fakeBrowser();
  const fetched = await fetchChart(world, 'png', { env: { BROWSER: browser } });
  expect(fetched.status).toBe(200);
  expect(fetched.headers.get('content-type')).toBe('image/png');
  expect([...fetched.bytes.slice(0, 8)]).toEqual(signature);
  expect(browser.screenshots()[0]?.html).toContain('<title>Cumulative flow</title>');
  const unwired = await fetchChart(world, 'png');
  expect(JSON.parse(text(unwired.bytes))).toEqual({ status: 'error', reason: 'not_wired' });
}

async function exportsCarryLineage(world: BoardWorld): Promise<void> {
  const rendered = await jsonOf(world, 'burndown');
  expect(rendered.lineage.excluded.count).toBe(0);
  expect(rendered.lineage.stale).toBeNull();
  const lines = [
    `Source: ${rendered.lineage.source}.`,
    'As of 2026-10-02 09:00 UTC.',
    `Filters: harnessId ${world.harnessId}.`,
  ];
  const svg = text((await fetchChart(world, 'svg', { key: 'burndown' })).bytes);
  const browser = fakeBrowser();
  await fetchChart(world, 'png', { key: 'burndown', env: { BROWSER: browser } });
  const png = browser.screenshots()[0]?.html ?? '';
  for (const line of lines) {
    expect(svg).toContain(line);
    expect(png).toContain(line);
  }
}

describe.skipIf(!testServer)('#199 GET /api/charts/:key and POST /api/charts/render', () => {
  it('#199 the CSV export of every standard chart equals the rows the chart drew', () =>
    inWorld(csvEqualsRows));
  it('#199 cumulative flow is folded from the event log, with its lineage', () =>
    inWorld(flowFromTheLog));
  it('#199 the SVG export stands alone, styled by the app stylesheet and with no inline style', () =>
    inWorld(svgStandsAlone));
  it('#199 a chart over a source with a delivery waiting more than five minutes renders its staleness note', () =>
    inWorld(staleNote));
  it('#199 a delivery waiting less than five minutes leaves the chart fresh', () =>
    inWorld(freshWithinFiveMinutes));
  it('#199 a spec referencing a query not on the whitelist is refused by its closed-set reason', () =>
    inWorld(offTheWhitelist));
  it('#199 a person who cannot read the workflow gets nothing, and a viewer of its area does', () =>
    inWorld(strangerSeesNothing));
  it('#199 PNG is drawn by the browser binding, and says not wired without it', () =>
    inWorld(pngThroughTheBrowser));
  it('#199 the downloaded SVG and PNG of a fresh chart with nothing left out name its source, as-of time and filters', () =>
    inWorld(exportsCarryLineage));
});

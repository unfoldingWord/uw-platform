import { describe, expect, it } from 'vitest';
import { renderedChartSchema } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { DEFAULT_SPEND_CAP } from '@uw/harness';
import { systemClock } from '../ports/clock.ts';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { measureApp } from '../testing/measure-app.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

async function inWorld(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, systemClock)));
}

function specOver(query: string, harnessId: string) {
  return {
    title: 'A chart an agent asked for',
    type: 'line',
    query: { key: query, params: { harnessId } },
    encodings: { x: 'day', y: ['open'], series: null },
    format: { x: 'date', y: 'count', currency: null },
  };
}

async function standardChart(world: BoardWorld): Promise<void> {
  const app = measureApp(world.db, {});
  const args = { chart: 'cumulative_flow', params: { harnessId: world.harnessId }, spec: null };
  const called = await app.verb(world.rowanEmail, 'render_chart', args);
  expect(called.isError).toBe(false);
  const rendered = renderedChartSchema.parse(called.body);
  expect(rendered.svg).toContain('<title>Cumulative flow</title>');
  expect(rendered.table.columns.map((column) => column.key)).toEqual(['day', 'stage', 'items']);
  expect(rendered.lineage.query).toBe('item_cumulative_flow');
}

async function specOnTheWhitelist(world: BoardWorld): Promise<void> {
  const app = measureApp(world.db, {});
  const args = { chart: null, params: {}, spec: specOver('item_burndown', world.harnessId) };
  const called = await app.verb(world.rowanEmail, 'render_chart', args);
  expect(called.isError).toBe(false);
  expect(renderedChartSchema.parse(called.body).table.columns.map((c) => c.key)).toEqual([
    'day',
    'open',
  ]);
}

async function offTheWhitelist(world: BoardWorld): Promise<void> {
  const app = measureApp(world.db, {});
  const args = { chart: null, params: {}, spec: specOver('all_gifts', world.harnessId) };
  const called = await app.verb(world.rowanEmail, 'render_chart', args);
  expect(called.isError).toBe(true);
  expect(called.body).toMatchObject({ reason: 'chart_query_not_allowed' });
}

async function unknownColumn(world: BoardWorld): Promise<void> {
  const app = measureApp(world.db, {});
  const spec = {
    ...specOver('item_burndown', world.harnessId),
    encodings: { x: 'day', y: ['amount'], series: null },
  };
  const called = await app.verb(world.rowanEmail, 'render_chart', {
    chart: null,
    params: {},
    spec,
  });
  expect(called.body).toMatchObject({ reason: 'chart_encoding_unknown' });
}

async function seriesOverManyMeasures(world: BoardWorld): Promise<void> {
  const app = measureApp(world.db, {});
  const spec = {
    ...specOver('item_cumulative_flow', world.harnessId),
    encodings: { x: 'day', y: ['items', 'items'], series: 'stage' },
  };
  const called = await app.verb(world.rowanEmail, 'render_chart', {
    chart: null,
    params: {},
    spec,
  });
  expect(called.isError).toBe(true);
  expect(called.body).toMatchObject({
    reason: 'malformed_command',
    detail: { fields: ['spec.encodings.y'] },
  });
}

async function asPerson(
  world: BoardWorld,
  person: { readonly id: string; readonly email: string },
) {
  const at = systemClock.now();
  const principal = await personOn(world.db, person.id, person.email, at);
  const traceId = crypto.randomUUID();
  const logger = createLogger(
    { traceId, commit: 'test', route: 'POST /mcp', principal: principal.identity },
    () => undefined,
  );
  const context = {
    principal,
    host: 'external' as const,
    at,
    traceId,
    kernel: kernelOn(world.db, systemClock),
    db: world.db,
    commit: 'test',
    cap: DEFAULT_SPEND_CAP,
    logger,
  };
  const args = { chart: 'burndown', params: { harnessId: world.harnessId }, spec: null };
  return callVerb(context, 'render_chart', args, verbHandlers);
}

async function hiddenFromStrangers(world: BoardWorld): Promise<void> {
  const stranger = await asPerson(world, world.stranger);
  expect(stranger.isError).toBe(true);
  const [block] = stranger.content;
  const body: unknown = JSON.parse(block?.type === 'text' ? block.text : '{}');
  expect(body).toMatchObject({ reason: 'harness_not_found' });
  const viewer = await asPerson(world, world.viewer);
  expect(viewer.isError ?? false).toBe(false);
}

describe.skipIf(!testServer)('#199 render_chart', () => {
  it('#199 draws a standard chart: its SVG, its table and its lineage', () =>
    inWorld(standardChart));
  it('#199 draws a spec over a whitelisted query', () => inWorld(specOnTheWhitelist));
  it('#199 refuses a spec referencing a query not on the whitelist, by its closed-set reason', () =>
    inWorld(offTheWhitelist));
  it('#199 refuses an encoding that names no column of the query', () => inWorld(unknownColumn));
  it('#199 refuses a series split over more than one measure, naming the y encoding', () =>
    inWorld(seriesOverManyMeasures));
  it('#199 answers as if the workflow did not exist to a person who cannot read it', () =>
    inWorld(hiddenFromStrangers));
});

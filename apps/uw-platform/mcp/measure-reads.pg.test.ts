import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { entityMeasures } from '../measures/entity-measures.ts';
import { addRefusedHosts } from '../measures/runs.ts';
import { measureApp } from '../testing/measure-app.ts';
import {
  covertlyServedProject,
  day,
  observe,
  readWorld,
  savedDashboard,
  type Observation,
  type ReadWorld,
} from '../testing/measure-reads.ts';
import { newId } from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

type Body = Record<string, unknown>;

async function verb(world: ReadWorld, email: string | null, name: string, args: Body) {
  const called = await measureApp(world.db, {}).verb(email ?? '', name, args);
  return called.body;
}

async function seeded(db: Database): Promise<ReadWorld> {
  const world = await readWorld(db);
  const { door43, uw, hidden } = world.sites;
  await observe(
    world,
    { kind: 'scheduled', at: day(1) },
    new Map<string, Observation>([
      [door43, { score: 60 }],
      [uw, { score: 70 }],
      [hidden, { score: 10 }],
    ]),
  );
  await observe(
    world,
    { kind: 'scheduled', at: day(2) },
    new Map<string, Observation>([
      [door43, 'timed_out'],
      [uw, { score: 90 }],
      [hidden, { score: 20 }],
    ]),
  );
  await observe(
    world,
    { kind: 'trial', at: day(3) },
    new Map<string, Observation>([
      [door43, { score: 5 }],
      [uw, { score: 5 }],
    ]),
  );
  return world;
}

const organization = { kind: 'organization', resource_kind: 'website' } as const;

async function averagesLatestScheduled(db: Database): Promise<void> {
  const world = await seeded(db);
  const read = await verb(world, world.admin.email, 'read_metric', {
    measureId: world.measureId,
    metric: 'average_score',
    context: organization,
  });
  expect(read).toMatchObject({
    figure: 90,
    target: 80,
    coverage: { scored: 1, total: 2, failed: [{ reason: 'timed_out', count: 1 }] },
  });
  expect(JSON.stringify(read)).not.toContain(world.sites.hidden);
  const wide = await verb(world, world.wide.email, 'read_metric', {
    measureId: world.measureId,
    metric: 'average_score',
    context: organization,
  });
  expect(wide).toMatchObject({ figure: 55, coverage: { scored: 2, total: 3 } });
}

async function readsPageWithDescendants(db: Database): Promise<void> {
  const world = await seeded(db);
  const read = (page_id: string, descendants: boolean) =>
    verb(world, world.admin.email, 'read_metric', {
      measureId: world.measureId,
      metric: 'latest_score',
      context: { kind: 'page', page_id, descendants },
    });
  expect(await read(world.project, false)).toMatchObject({ figure: 90, coverage: { total: 1 } });
  expect(await read(world.program, false)).toMatchObject({ figure: null, coverage: { total: 0 } });
  expect(await read(world.program, true)).toMatchObject({ figure: 90, coverage: { total: 1 } });
}

async function listsReadableObservations(db: Database): Promise<void> {
  const world = await seeded(db);
  const first = await verb(world, world.admin.email, 'read_observations', {
    measureId: world.measureId,
    limit: 3,
  });
  const rows = first['observations'] as { runKind: string; resourceId: string }[];
  expect(rows.map((row) => row.runKind)).toEqual(['trial', 'trial', 'scheduled']);
  expect(first['nextCursor']).toBe('3');
  const rest = await verb(world, world.admin.email, 'read_observations', {
    measureId: world.measureId,
    cursor: '3',
  });
  expect(rest['observations']).toHaveLength(3);
  expect(rest['nextCursor']).toBeNull();
  expect(JSON.stringify([first, rest])).not.toContain(world.sites.hidden);
  const one = await verb(world, world.admin.email, 'read_observations', {
    measureId: world.measureId,
    resourceId: world.sites.uw,
    since: day(2).toISOString(),
  });
  expect(one['observations']).toHaveLength(2);
}

async function previewsFromTrialOutput(db: Database): Promise<void> {
  const world = await seeded(db);
  const dashboardId = await savedDashboard(world, organization, [
    { kind: 'figure', measure: world.measureId, metric: 'average_score' },
    { kind: 'bars', measure: world.measureId, metric: 'no_such_metric' },
    { kind: 'status', measure: world.measureId },
  ]);
  const preview = await verb(world, world.admin.email, 'preview_dashboard', {
    dashboardId,
    hostPageId: null,
  });
  expect(preview).toMatchObject({
    dashboardId,
    problems: [{ path: 'panels.1.metric' }],
    panels: [
      { index: 0, kind: 'figure', drawn: true, coverage: { scored: 2, total: 2 } },
      { index: 1, kind: 'bars', drawn: false, problems: [{ path: 'panels.1.metric' }] },
      { index: 2, kind: 'status', drawn: true },
    ],
  });
}

async function previewsHostContext(db: Database): Promise<void> {
  const world = await seeded(db);
  const panels = [{ kind: 'figure', measure: world.measureId, metric: 'latest_score' }] as const;
  const card = await savedDashboard(world, { kind: 'host', descendants: true }, panels);
  const unhosted = await verb(world, world.admin.email, 'preview_dashboard', {
    dashboardId: card,
    hostPageId: null,
  });
  expect(unhosted['problems']).toEqual([
    { path: 'hostPageId', message: expect.any(String) as unknown },
  ]);
  const hosted = await verb(world, world.admin.email, 'preview_dashboard', {
    dashboardId: card,
    hostPageId: world.program,
  });
  expect(hosted).toMatchObject({ problems: [], panels: [{ drawn: true, coverage: { total: 1 } }] });
}

async function hidesMeasureLikeMissing(db: Database): Promise<void> {
  const world = await seeded(db);
  const args = (measureId: string) => ({
    measureId,
    metric: 'average_score',
    context: organization,
  });
  const hidden = await verb(world, world.stranger.email, 'read_metric', args(world.measureId));
  const missing = await verb(world, world.stranger.email, 'read_metric', args(newId()));
  expect(hidden).toMatchObject({ status: 'error', reason: 'page_not_found' });
  expect(missing).toMatchObject({ status: 'error', reason: 'page_not_found' });
  const observations = await verb(world, world.stranger.email, 'read_observations', {
    measureId: world.measureId,
  });
  expect(observations).toMatchObject({ status: 'error', reason: 'page_not_found' });
  const unknownMetric = await verb(world, world.admin.email, 'read_metric', {
    ...args(world.measureId),
    metric: 'no_such_metric',
  });
  expect(unknownMetric).toMatchObject({ status: 'error', reason: 'property_not_found' });
}

async function givesEntityMeasures(db: Database): Promise<void> {
  const world = await seeded(db);
  const reader = (actor: typeof world.admin) => ({ db, actor, at: new Date() });
  const program = await entityMeasures(reader(world.admin), world.program);
  expect(program).toEqual([
    expect.objectContaining({
      measureId: world.measureId,
      metrics: expect.arrayContaining([
        expect.objectContaining({ metric: 'latest_score', figure: 90, target: 80 }),
      ]) as unknown,
    }),
  ]);
  expect(JSON.stringify(program)).not.toContain('resources');
  expect(await entityMeasures(reader(world.stranger), world.program)).toEqual([]);
  expect(await entityMeasures(reader(world.admin), null)).toEqual([]);
}

async function hidesMeasureOfUnreadableResources(db: Database): Promise<void> {
  const world = await seeded(db);
  const project = await covertlyServedProject(world);
  const reader = (actor: typeof world.admin) => ({ db, actor, at: new Date() });
  expect(await entityMeasures(reader(world.admin), project)).toEqual([]);
  expect(await entityMeasures(reader(world.wide), project)).toEqual([
    expect.objectContaining({ measureId: world.measureId }),
  ]);
}

async function keepsNewestWhenSeriesIsLong(db: Database): Promise<void> {
  const world = await seeded(db);
  const copied = sql`
    FROM observations o JOIN measure_runs r ON r.id = o.run_id, generate_series(1, 20000) AS g
    WHERE o.resource_page_id = ${world.sites.uw} AND o.observed_at = ${day(1).toISOString()}`;
  const runId = sql`md5(o.id::text || g::text)::uuid`;
  const earlier = sql`make_interval(mins => g)`;
  await db.execute(sql`
    INSERT INTO measure_runs (id, measure_page_id, measure_version, tool_hash, kind,
      requested_by, state, area, created_at, finished_at)
    SELECT ${runId}, r.measure_page_id, r.measure_version, r.tool_hash, r.kind,
      r.requested_by, r.state, r.area, r.created_at - ${earlier}, r.finished_at ${copied}`);
  await db.execute(sql`
    INSERT INTO observations (id, run_id, measure_page_id, measure_version, resource_page_id,
      observed_at, tool_version, values, outcome, area)
    SELECT gen_random_uuid(), ${runId}, o.measure_page_id, o.measure_version,
      o.resource_page_id, o.observed_at - ${earlier}, o.tool_version, '{"score":1}'::jsonb,
      'ok', o.area ${copied}`);
  const read = await verb(world, world.admin.email, 'read_metric', {
    measureId: world.measureId,
    metric: 'latest_score',
    context: { kind: 'page', page_id: world.project, descendants: false },
  });
  expect(read).toMatchObject({ figure: 90 });
}

async function namesRefusedHostsToWholeReader(db: Database): Promise<void> {
  const world = await readWorld(db);
  const { door43, hidden } = world.sites;
  const outcomes = new Map<string, Observation>([
    [door43, { score: 60 }],
    [hidden, 'host_refused'],
  ]);
  const runId = await observe(world, { kind: 'scheduled', at: day(1) }, outcomes);
  await addRefusedHosts(db, runId, ['secret.example.org']);
  const read = (email: string | null) =>
    verb(world, email, 'read_measure_run', { measureId: world.measureId, runId });
  const partial = await read(world.admin.email);
  expect(partial).toMatchObject({ runId, refusedHosts: [] });
  expect(JSON.stringify(partial)).not.toContain('secret.example.org');
  expect(await read(world.wide.email)).toMatchObject({
    refusedHosts: ['secret.example.org'],
    refusedHostsMore: false,
  });
}

async function capsRefusedHostsItNames(db: Database): Promise<void> {
  const world = await readWorld(db);
  const { door43 } = world.sites;
  const runId = await observe(
    world,
    { kind: 'scheduled', at: day(1) },
    new Map([[door43, 'host_refused']]),
  );
  const hosts = Array.from({ length: 130 }, (_, n) => `h${String(n).padStart(3, '0')}.example.net`);
  await addRefusedHosts(db, runId, hosts);
  const read = await verb(world, world.wide.email, 'read_measure_run', {
    measureId: world.measureId,
    runId,
  });
  expect(read['refusedHosts']).toEqual(hosts.slice(0, 100));
  expect(read['refusedHostsMore']).toBe(true);
}

async function leavesOutHostTooLongToName(db: Database): Promise<void> {
  const world = await readWorld(db);
  const runId = await observe(
    world,
    { kind: 'scheduled', at: day(1) },
    new Map([[world.sites.door43, 'host_refused']]),
  );
  const long = `${'a'.repeat(250)}.example.net:8443`;
  await addRefusedHosts(db, runId, ['cdn.example.net', long]);
  const read = await verb(world, world.wide.email, 'read_measure_run', {
    measureId: world.measureId,
    runId,
  });
  expect(read).toMatchObject({ refusedHosts: ['cdn.example.net'], refusedHostsMore: true });
}

describe.skipIf(!testServer)('ADR 0034 an agent reads figures, rows and previews by verbs', () => {
  it('gives resolve_context the latest metrics of the resources serving an entity', () =>
    withAppDatabase(givesEntityMeasures));

  it('names no measure to resolve_context that only an unreadable resource reveals', () =>
    withAppDatabase(hidesMeasureOfUnreadableResources));

  it('averages the latest scheduled scores, leaves out trials, failures and unreadable sites', () =>
    withAppDatabase(averagesLatestScheduled));

  it('reads the newest observations when a series is longer than one read holds', () =>
    withAppDatabase(keepsNewestWhenSeriesIsLong));

  it('reads a page context with and without its descendants', () =>
    withAppDatabase(readsPageWithDescendants));

  it('pages through the observations the reader may read, newest first', () =>
    withAppDatabase(listsReadableObservations));

  it('previews a dashboard from the trial output and names each problem', () =>
    withAppDatabase(previewsFromTrialOutput));

  it('previews a report card only with a host page', () => withAppDatabase(previewsHostContext));

  it('names the hosts a run refused only to a reader who may read every resource of it', () =>
    withAppDatabase(namesRefusedHostsToWholeReader));

  it('names at most a hundred refused hosts and says when there are more', () =>
    withAppDatabase(capsRefusedHostsItNames));

  it('leaves out a refused host too long to name and says there are more', () =>
    withAppDatabase(leavesOutHostTooLongToName));

  it('answers a hidden measure exactly as a missing one', () =>
    withAppDatabase(hidesMeasureLikeMissing));
});

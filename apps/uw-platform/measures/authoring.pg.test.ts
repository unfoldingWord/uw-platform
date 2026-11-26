import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { MeasureFrontmatter, Principal } from '@uw/contracts';
import { collectionsAt } from '../testing/collections.ts';
import {
  agentOf,
  forceActive,
  geoMeasure,
  MEASURE_AREA,
  measureWorld,
  newId,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { readPage } from '../pages/store.ts';
import { activateMeasure } from './activation.ts';
import { activationFor, measurePauses, pauseActivation } from './activations.ts';
import { saveDashboard, saveMeasure } from './authoring.ts';
import { measurePageOf } from './measure-pages.ts';

const at = collectionsAt;

function request(world: MeasureWorld, actor: Principal = agentOf(world.admin)) {
  return { db: world.db, actor, traceId: newId(), at };
}

function measureInput(measureId: string, measure: MeasureFrontmatter = geoMeasure()) {
  return {
    measureId,
    expectedVersion: null,
    jdArea: MEASURE_AREA,
    title: 'GEO score of our websites',
    slug: `geo-score-${measureId.slice(0, 8)}`,
    bodyMd: 'How findable our websites are to search engines and answer engines.',
    measure,
  };
}

const scored = geoMeasure({
  values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
  metrics: [{ key: 'average_score', name: 'Average score', value: 'score', rule: 'average' }],
});

async function saved(world: MeasureWorld, measure: MeasureFrontmatter = geoMeasure()) {
  const measureId = newId();
  const made = await saveMeasure(request(world), measureInput(measureId, measure));
  if (!made.ok) throw new Error(`refused: ${made.reason}`);
  return made.value;
}

async function landsSuggestedAwaitingTrial(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const made = await saved(world);
  expect(made).toMatchObject({ version: 1, status: 'suggested', awaiting: 'trial' });
  expect(made.toolHash).toMatch(/^[0-9a-f]{64}$/);
  expect(made.problems).toEqual([]);
}

async function namesViewResourcesView(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measure = geoMeasure({ resources: { view: newId() }, report_card: newId() });
  const made = await saved(world, measure);
  expect(made.problems.map((problem) => problem.path)).toEqual([
    'measure.resources.view',
    'measure.report_card',
  ]);
  expect(made.status).toBe('suggested');
}

async function updatesOwnSuggestedMeasure(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const made = await saved(world);
  const input = { ...measureInput(made.measureId, scored), expectedVersion: 1 };
  const updated = await saveMeasure(request(world), input);
  expect(updated).toMatchObject({ ok: true, value: { version: 2, status: 'suggested' } });
  const stale = await saveMeasure(request(world), input);
  expect(stale).toMatchObject({ ok: false, reason: 'stale_version' });
}

async function refusesPersonAgentMay(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const refused = await saveMeasure(request(world, agentOf(world.stranger)), measureInput(newId()));
  expect(refused).toMatchObject({ ok: false, reason: 'not_permitted' });
}

async function returnsActiveMeasureSuggested(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const made = await saved(world, scored);
  const active = await forceActive(world, made.measureId);
  expect((await activationFor(db, made.measureId))?.pausedReason).toBeNull();
  const input = { ...measureInput(made.measureId, scored), expectedVersion: active };
  const changed = await saveMeasure(request(world), {
    ...input,
    bodyMd: 'A clearer explanation.',
  });
  expect(changed).toMatchObject({
    ok: true,
    value: { status: 'suggested', awaiting: 'activation' },
  });
  expect((await activationFor(db, made.measureId))?.pausedReason).toBe('changed');
  await pauseActivation(db, made.measureId, 'retired');
  expect((await activationFor(db, made.measureId))?.pausedReason).toBe('changed');
}

function reactivatedAfterEachSave(world: MeasureWorld, measureId: string): Database {
  let reactivated = false;
  const reactivate = async () => {
    const page = await measurePageOf(world.db, measureId);
    if (reactivated || page?.status !== 'suggested') return;
    reactivated = true;
    const command = {
      command: 'activate_measure' as const,
      requestId: newId(),
      measureId,
      expectedVersion: page.version,
      dashboards: [],
    };
    const context = { files: world.files, traceId: newId(), at };
    const done = await activateMeasure(world.db, world.admin, command, context);
    if (!done.ok) throw new Error(done.reason);
  };
  const transaction: Database['transaction'] = async (work, config) => {
    const result = await world.db.transaction(work, config);
    await reactivate();
    return result;
  };
  return new Proxy(world.db, {
    get: (target, key, receiver) =>
      key === 'transaction' ? transaction : Reflect.get(target, key, receiver),
  });
}

async function keepsActivationMadeAfterSave(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const made = await saved(world, scored);
  const active = await forceActive(world, made.measureId);
  const racing = { ...request(world), db: reactivatedAfterEachSave(world, made.measureId) };
  const input = { ...measureInput(made.measureId, scored), expectedVersion: active };
  const changed = await saveMeasure(racing, { ...input, bodyMd: 'A clearer explanation.' });
  expect(changed).toMatchObject({ ok: true, value: { version: active + 1 } });
  expect(await measurePageOf(db, made.measureId)).toMatchObject({
    status: 'active',
    version: active + 2,
  });
  expect(await activationFor(db, made.measureId)).toMatchObject({
    version: active + 2,
    pausedReason: null,
  });
}

async function pausesOnlyEarlierActivation(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const made = await saved(world, scored);
  const active = await forceActive(world, made.measureId);
  const page = await readPage(db, world.admin, made.measureId, at);
  if (page === null) throw new Error('no measure page');
  const left = (version: number) =>
    db.transaction((tx) => measurePauses.leftActive(tx, { ...page, status: 'suggested', version }));
  await left(active);
  expect((await activationFor(db, made.measureId))?.pausedReason).toBeNull();
  await left(active + 1);
  expect((await activationFor(db, made.measureId))?.pausedReason).toBe('changed');
}

async function writesPanelsFencedBlocks(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measure = await saved(world, scored);
  const dashboardId = newId();
  const made = await saveDashboard(request(world), {
    dashboardId,
    expectedVersion: null,
    jdArea: MEASURE_AREA,
    title: 'Website findability',
    slug: 'website-findability',
    intro: 'How findable each website we maintain is.',
    context: { kind: 'organization', resource_kind: 'website' },
    panels: [
      { kind: 'figure', measure: measure.measureId, metric: 'average_score' },
      { kind: 'bars', measure: measure.measureId, metric: 'median_score' },
      { kind: 'table', measure: measure.measureId, values: [{ value: 'grade' }] },
      { kind: 'status', measure: newId() },
    ],
  });
  expect(made).toMatchObject({ ok: true, value: { dashboardId, version: 1 } });
  if (!made.ok) return;
  expect(made.value.status).toBe('suggested');
  expect(made.value.problems.map((problem) => problem.path)).toEqual([
    'panels.1.metric',
    'panels.2.values.0.value',
    'panels.3.measure',
  ]);
}

async function namesContextPageAgent(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const made = await saveDashboard(request(world), {
    dashboardId: newId(),
    expectedVersion: null,
    jdArea: MEASURE_AREA,
    title: 'Program findability',
    slug: 'program-findability',
    intro: '',
    context: { kind: 'page', page_id: newId(), descendants: true },
    panels: [{ kind: 'status', measure: (await saved(world)).measureId }],
  });
  expect(made.ok && made.value.problems).toEqual([
    { path: 'context.page_id', message: 'names no page you can read' },
  ]);
}

describe.skipIf(!testServer)('an agent saves a measure from typed fields', () => {
  it('lands it suggested, awaiting a trial, with its tool hash and no problems', () =>
    withAppDatabase(landsSuggestedAwaitingTrial));

  it('names a view that is not a Resources view and a report card that is not a dashboard', () =>
    withAppDatabase(namesViewResourcesView));

  it('updates its own suggested measure and refuses a stale version', () =>
    withAppDatabase(updatesOwnSuggestedMeasure));

  it('refuses a person or agent who may not write the area', () =>
    withAppDatabase(refusesPersonAgentMay));

  it('returns an active measure to suggested and pauses its runs when the agent changes it', () =>
    withAppDatabase(returnsActiveMeasureSuggested));

  it('never pauses an activation an admin made after the agent saved', () =>
    withAppDatabase(keepsActivationMadeAfterSave));

  it('pauses only an activation of a version older than the one saved', () =>
    withAppDatabase(pausesOnlyEarlierActivation));
});

describe.skipIf(!testServer)('an agent saves a dashboard from typed fields', () => {
  it('writes its panels as fenced blocks, lands it suggested and names unknown keys', () =>
    withAppDatabase(writesPanelsFencedBlocks));

  it('names a context page the agent cannot read', () => withAppDatabase(namesContextPageAgent));
});

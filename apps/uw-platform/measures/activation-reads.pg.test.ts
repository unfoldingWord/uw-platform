import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { MeasureFrontmatter, Principal } from '@uw/contracts';
import { collectionsAt, personWith, rowIn } from '../testing/collections.ts';
import {
  agentOf,
  fakeMeasureSandbox,
  geoMeasure,
  geoOutput,
  inlineMeasureRuns,
  MEASURE_AREA,
  measureWorld,
  newId,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { activateMeasure } from './activation.ts';
import { saveMeasure } from './authoring.ts';
import { startTrial } from './trial.ts';

const at = collectionsAt;
const OTHER_AREA = '30-39';

const scored = geoMeasure({
  values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
});

const banded = geoMeasure({
  values: [...scored.values, { key: 'band', name: 'Band', type: 'text', path: '/band' }],
});

type Scene = MeasureWorld & { readonly measureId: string; readonly broad: Principal };

async function site(world: MeasureWorld, title: string, address: string, area: string) {
  const author = await personWith(world.db, 'measure-author', [
    { role: 'editor', area },
    { role: 'viewer', area: MEASURE_AREA },
  ]);
  const values = { kind: 'website', address };
  await rowIn(world.db, author, { collection: 'resource', jdArea: area, title, values });
}

function save(world: MeasureWorld, measureId: string, expectedVersion: number | null) {
  return (measure: MeasureFrontmatter) =>
    saveMeasure(
      { db: world.db, actor: agentOf(world.admin), traceId: newId(), at },
      {
        measureId,
        expectedVersion,
        jdArea: MEASURE_AREA,
        title: 'GEO score',
        slug: `geo-${measureId.slice(0, 8)}`,
        bodyMd: '',
        measure,
      },
    );
}

async function trialled(db: Database, uwArea: string): Promise<Scene> {
  const world = await measureWorld(db);
  await site(world, 'unfoldingWord', 'https://www.unfoldingword.org/', uwArea);
  await site(world, 'Door43', 'https://door43.org/', OTHER_AREA);
  const broad = await personWith(db, 'measure-broad', [
    { role: 'admin', area: MEASURE_AREA },
    { role: 'viewer', area: null },
  ]);
  const measureId = newId();
  await save(world, measureId, null)(scored);
  const outputs = new Map([
    ['www.unfoldingword.org', geoOutput(81)],
    ['door43.org', { stdout: JSON.stringify({ score: 64 }) }],
  ]);
  const sandbox = fakeMeasureSandbox(outputs);
  const binding = inlineMeasureRuns({ db, files: world.files, sandbox, now: () => at });
  const command = { command: 'run_measure_trial' as const, requestId: newId(), measureId };
  const starter = { binding, traceId: newId() };
  await startTrial(db, broad, { ...command, expectedVersion: 1 }, starter, at);
  await save(world, measureId, 1)(banded);
  return { ...world, measureId, broad };
}

function activate(scene: Scene, actor: Principal) {
  const command = {
    command: 'activate_measure' as const,
    requestId: newId(),
    measureId: scene.measureId,
    expectedVersion: 2,
    dashboards: [],
  };
  return activateMeasure(scene.db, actor, command, { files: scene.files, traceId: newId(), at });
}

async function judgesOnlyReadableOutput(db: Database): Promise<void> {
  const scene = await trialled(db, MEASURE_AREA);
  expect(await activate(scene, scene.broad)).toEqual({ ok: false, reason: 'trial_unreadable' });
  expect(await activate(scene, scene.admin)).toEqual({ ok: true });
}

async function needsOneReadableObservation(db: Database): Promise<void> {
  const scene = await trialled(db, OTHER_AREA);
  expect(await activate(scene, scene.broad)).toEqual({ ok: false, reason: 'trial_unreadable' });
  expect(await activate(scene, scene.admin)).toEqual({ ok: false, reason: 'trial_required' });
}

describe.skipIf(!testServer)(
  'activation reads only the output the activating admin can read',
  () => {
    it('activates when every readable observation reads cleanly, whatever an unreadable one holds', () =>
      withAppDatabase(judgesOnlyReadableOutput));

    it('asks for a trial when the admin can read no ok observation of it', () =>
      withAppDatabase(needsOneReadableObservation));
  },
);

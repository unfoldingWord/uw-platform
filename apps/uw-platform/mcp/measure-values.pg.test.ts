import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import {
  accepted,
  addSites,
  measureArgs,
  scene,
  sites,
  type Scene,
} from '../testing/measure-scene.ts';
import { geoMeasure, MEASURE_AREA, newId } from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

type Body = Record<string, unknown>;

const scoreAt = (path: string, type: 'number' | 'text' = 'number') =>
  geoMeasure({
    values: [{ key: 'score', name: 'Score', type, path }],
    metrics: [{ key: 'latest_score', name: 'Score', value: 'score', rule: 'latest' }],
  });

async function trialOf(made: Scene, measureId: string, expectedVersion: number): Promise<void> {
  const trial = await made.app.command(made.email, 'run_measure_trial', {
    measureId,
    expectedVersion,
  });
  expect(trial.body).toMatchObject({ status: 'accepted' });
}

async function figureDashboard(made: Scene, measureId: string, context: Body): Promise<string> {
  const dashboardId = newId();
  await accepted(made, 'save_dashboard', {
    dashboardId,
    expectedVersion: null,
    jdArea: MEASURE_AREA,
    title: `Scores ${dashboardId.slice(0, 8)}`,
    slug: `scores-${dashboardId.slice(0, 8)}`,
    intro: '',
    context,
    panels: [{ kind: 'figure', measure: measureId, metric: 'latest_score' }],
  });
  return dashboardId;
}

const organization = { kind: 'organization', resource_kind: 'website' };

async function keepsTrialWhosePathsWereWrong(db: Database): Promise<void> {
  const made = await scene(db);
  await addSites(made);
  const measureId = newId();
  await accepted(made, 'save_measure', measureArgs(measureId, null, scoreAt('/result/score')));
  await trialOf(made, measureId, 1);
  const run = await accepted(made, 'read_measure_run', { measureId, runId: null });
  expect(run).toMatchObject({ kind: 'trial', state: 'ok' });
  const fixed = await accepted(made, 'save_measure', measureArgs(measureId, 1, scoreAt('/score')));
  expect(fixed).toMatchObject({ awaiting: 'activation', problems: [] });
  const activated = await made.app.command(made.email, 'activate_measure', {
    measureId,
    expectedVersion: 2,
    dashboards: [],
  });
  expect(activated.body).toMatchObject({ status: 'accepted' });
}

async function checksValuesAgainstTrialOutput(db: Database): Promise<void> {
  const made = await scene(db);
  await addSites(made);
  const measureId = newId();
  await accepted(made, 'save_measure', measureArgs(measureId, null));
  await trialOf(made, measureId, 1);
  const wrong = await accepted(made, 'save_measure', measureArgs(measureId, 1, scoreAt('/band')));
  const problems = wrong['problems'] as { path: string; message: string }[];
  expect(problems).toHaveLength(sites.length);
  expect(problems[0]).toEqual({
    path: 'measure.values.0.path',
    message: expect.stringMatching(/found text at \/band, expected a number/),
  });
  const dashboardId = await figureDashboard(made, measureId, organization);
  const stale = await accepted(made, 'preview_dashboard', { dashboardId, hostPageId: null });
  expect(stale['problems']).toContainEqual({
    path: `measures.${measureId}.values.0.path`,
    message: expect.stringMatching(/expected a number/),
  });
  expect(stale['panels']).toMatchObject([{ coverage: { scored: 0, total: 3 } }]);
  const right = await accepted(made, 'save_measure', measureArgs(measureId, 2, scoreAt('/score')));
  expect(right).toMatchObject({ awaiting: 'activation', problems: [] });
  const drawn = await accepted(made, 'preview_dashboard', { dashboardId, hostPageId: null });
  expect(drawn).toMatchObject({ problems: [], panels: [{ drawn: true }] });
  expect(drawn['panels']).toMatchObject([{ coverage: { scored: 3, total: 3 } }]);
}

async function flagsReportCardWithoutHost(db: Database): Promise<void> {
  const made = await scene(db);
  const measureId = newId();
  await accepted(made, 'save_measure', measureArgs(measureId, null, scoreAt('/score')));
  const card = await figureDashboard(made, measureId, organization);
  const host = await figureDashboard(made, measureId, { kind: 'host', descendants: true });
  const flagged = await accepted(
    made,
    'save_measure',
    measureArgs(measureId, 1, { ...scoreAt('/score'), report_card: card }),
  );
  expect(flagged['problems']).toEqual([
    { path: 'measure.report_card', message: expect.stringMatching(/context kind is host/) },
  ]);
  const clean = await accepted(
    made,
    'save_measure',
    measureArgs(measureId, 2, { ...scoreAt('/score'), report_card: host }),
  );
  expect(clean['problems']).toEqual([]);
}

function bigAudit(address: string, score: number) {
  const checks = Array.from({ length: 4000 }, (_, n) => ({ name: `check ${String(n)}` }));
  return { stdout: JSON.stringify({ score, address, checks }) };
}

type ReadObservation = {
  resourceId: string;
  raw: string | null;
  rawTruncated: boolean;
  outline: { path: string; sample: unknown }[] | null;
  problems: { path: string; message: string }[];
};

async function readsOneResourceAsAnOutline(db: Database): Promise<void> {
  const made = await scene(db, bigAudit);
  const [first] = await addSites(made);
  const measureId = newId();
  await accepted(made, 'save_measure', measureArgs(measureId, null, scoreAt('/result/score')));
  await trialOf(made, measureId, 1);
  const one = await accepted(made, 'read_measure_run', {
    measureId,
    runId: null,
    resourceId: first,
  });
  const observations = one['observations'] as ReadObservation[];
  expect(observations.map((each) => each.resourceId)).toEqual([first]);
  const [observed] = observations;
  expect(observed?.raw).toBeNull();
  expect(observed?.rawTruncated).toBe(false);
  expect(observed?.outline?.slice(0, 2)).toEqual([
    { path: '/score', type: 'number', sample: 81 },
    { path: '/address', type: 'text', sample: sites[0][1] },
  ]);
  expect(observed?.problems).toEqual([
    { path: 'measure.values.0.path', message: 'nothing at /result/score' },
  ]);
  expect(JSON.stringify(one).length).toBeLessThan(60_000);
}

async function carriesSchemaGuidance(db: Database): Promise<void> {
  const made = await scene(db);
  const measure = { ...geoMeasure(), command: ['geo', 'audit', '--url', '[url]'] };
  const refused = await made.app.verb(
    made.email,
    'save_measure',
    measureArgs(newId(), null, measure),
  );
  expect(refused.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
  const detail = refused.body['detail'] as { issues: string[] };
  expect(detail.issues).toContainEqual(expect.stringMatching(/^measure\.command: .*\{address\}/));
}

describe.skipIf(!testServer)(
  "a measure's values are checked against the trial's own output",
  () => {
    it('keeps a trial whose value paths were wrong, so fixing them needs no second trial', () =>
      withAppDatabase(keepsTrialWhosePathsWereWrong));

    it('names each value that does not read in save_measure and draws the preview from it', () =>
      withAppDatabase(checksValuesAgainstTrialOutput));

    it('flags a report card whose dashboard does not take the page it is shown on', () =>
      withAppDatabase(flagsReportCardWithoutHost));

    it('reads one resource of a run as an outline of pointers, never cut mid-JSON', () =>
      withAppDatabase(readsOneResourceAsAnOutline));

    it("returns the schema's own guidance with a malformed save_measure", () =>
      withAppDatabase(carriesSchemaGuidance));
  },
);

import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { accepted, addSites, measureArgs, scene, type Scene } from '../testing/measure-scene.ts';
import { geoMeasure, MEASURE_AREA, newId } from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const scored = geoMeasure({
  values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
  metrics: [
    { key: 'average_score', name: 'Average score', value: 'score', rule: 'average', target: 80 },
    { key: 'latest_score', name: 'Score', value: 'score', rule: 'latest', target: 80 },
  ],
});

async function dashboard(scene: Scene, measureId: string): Promise<string> {
  const dashboardId = newId();
  const saved = await accepted(scene, 'save_dashboard', {
    dashboardId,
    expectedVersion: null,
    jdArea: MEASURE_AREA,
    title: 'Website findability',
    slug: 'website-findability',
    intro: 'The SEO and GEO score of every website we maintain.',
    context: { kind: 'organization', resource_kind: 'website' },
    panels: [
      { kind: 'figure', measure: measureId, metric: 'average_score' },
      { kind: 'bars', measure: measureId, metric: 'latest_score' },
      { kind: 'status', measure: measureId },
    ],
  });
  expect(saved).toMatchObject({ dashboardId, status: 'suggested', problems: [] });
  return dashboardId;
}

async function letsAgentBuildResources(db: Database): Promise<void> {
  const made = await scene(db);
  await addSites(made);
  const measureId = newId();
  const first = await accepted(made, 'save_measure', measureArgs(measureId, null));
  expect(first).toMatchObject({ version: 1, status: 'suggested', awaiting: 'trial' });
  const trial = await made.app.command(made.email, 'run_measure_trial', {
    measureId,
    expectedVersion: 1,
  });
  expect(trial.body).toMatchObject({ status: 'accepted' });
  const run = await accepted(made, 'read_measure_run', { measureId, runId: null });
  expect(run).toMatchObject({ kind: 'trial', state: 'ok' });
  const observations = run['observations'] as { raw: string | null }[];
  expect(observations).toHaveLength(3);
  expect(JSON.parse(observations[0]?.raw ?? '{}')).toMatchObject({ band: 'good' });
  const second = await accepted(made, 'save_measure', measureArgs(measureId, 1, scored));
  expect(second).toMatchObject({ version: 2, awaiting: 'activation', problems: [] });
  const dashboardId = await dashboard(made, measureId);
  const activated = await made.app.command(made.email, 'activate_measure', {
    measureId,
    expectedVersion: 2,
    dashboards: [dashboardId],
  });
  expect(activated.body).toMatchObject({ status: 'accepted' });
  const now = await made.app.command(made.email, 'run_measure_now', {
    measureId,
    expectedVersion: 3,
  });
  expect(now.body).toMatchObject({ status: 'accepted' });
  const latest = await accepted(made, 'read_measure_run', { measureId, runId: null });
  expect(latest).toMatchObject({ kind: 'requested', state: 'ok' });
  const again = await made.app.verb(made.email, 'run_measure', { measureId });
  expect(again.body).toMatchObject({ status: 'error', reason: 'run_too_soon' });
}

async function answersHiddenMeasureExactly(db: Database): Promise<void> {
  const made = await scene(db);
  const measureId = newId();
  await accepted(made, 'save_measure', measureArgs(measureId, null));
  const strangerEmail = made.world.stranger.email ?? '';
  const hidden = await made.app.verb(strangerEmail, 'read_measure_run', {
    measureId,
    runId: null,
  });
  const missing = await made.app.verb(strangerEmail, 'read_measure_run', {
    measureId: newId(),
    runId: null,
  });
  expect(hidden.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
  expect(JSON.stringify(hidden.body).replace(measureId, 'id')).toBe(
    JSON.stringify(missing.body).replace(/[0-9a-f-]{36}/, 'id'),
  );
}

async function refusesAgentTrialActivation(db: Database): Promise<void> {
  const made = await scene(db);
  const listed = await made.app.verb(made.email, 'read_measure_run', {
    measureId: newId(),
    runId: null,
  });
  expect(listed.isError).toBe(true);
  for (const name of ['run_measure_trial', 'activate_measure', 'activate_dashboard']) {
    await expect(made.app.verb(made.email, name, { measureId: newId() })).rejects.toThrow(
      /Unknown tool/,
    );
  }
}

describe.skipIf(!testServer)('one request builds a GEO dashboard', () => {
  it('lets an agent build resources, a measure and a dashboard by verbs alone', () =>
    withAppDatabase(letsAgentBuildResources));

  it('answers a hidden measure exactly as a missing one', () =>
    withAppDatabase(answersHiddenMeasureExactly));

  it('refuses an agent the trial and the activation, which are person commands only', () =>
    withAppDatabase(refusesAgentTrialActivation));
});

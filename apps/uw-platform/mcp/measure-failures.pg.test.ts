import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { FakeOutput } from '../testing/measure-world.ts';
import { accepted, addSites, measureArgs, scene, type Scene } from '../testing/measure-scene.ts';
import { geoMeasure, newId } from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const reported: ReadonlyMap<string, FakeOutput> = new Map([
  [
    'www.unfoldingword.org',
    {
      stdout: JSON.stringify({ score: 0, error: 'HTTP 403', recommendations: [] }),
      refusedHosts: ['unfoldingword.org'],
    },
  ],
  ['door43.org', { stdout: JSON.stringify({ score: 0, error: 'Connection failed' }) }],
  ['translationcore.com', { stdout: JSON.stringify({ score: 92, error: null }) }],
]);

function outputOf(address: string): FakeOutput {
  return reported.get(new URL(address).host) ?? { stdout: '' };
}

function scored(failurePath?: string) {
  const measure = geoMeasure({
    values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
    metrics: [{ key: 'latest_score', name: 'Score', value: 'score', rule: 'latest' }],
  });
  return failurePath === undefined ? measure : { ...measure, failure_path: failurePath };
}

async function trialOf(made: Scene, measureId: string, expectedVersion: number): Promise<void> {
  const trial = await made.app.command(made.email, 'run_measure_trial', {
    measureId,
    expectedVersion,
  });
  expect(trial.body).toMatchObject({ status: 'accepted' });
}

type Observed = { title: string; outcome: string; reason: string | null; values: unknown };

async function observedOf(made: Scene, measureId: string): Promise<Observed[]> {
  const run = await accepted(made, 'read_measure_run', { measureId, runId: null });
  const observations = run['observations'] as Observed[];
  return observations.map(({ title, outcome, reason, values }) => ({
    title,
    outcome,
    reason,
    values,
  }));
}

async function failsWhatToolReports(db: Database): Promise<void> {
  const made = await scene(db, outputOf);
  await addSites(made);
  const measureId = newId();
  await accepted(made, 'save_measure', measureArgs(measureId, null, scored('/error')));
  await trialOf(made, measureId, 1);
  expect(await observedOf(made, measureId)).toEqual([
    { title: 'Door43', outcome: 'failed', reason: 'tool_failed', values: null },
    { title: 'translationCore', outcome: 'ok', reason: null, values: { score: 92 } },
    { title: 'unfoldingWord', outcome: 'failed', reason: 'host_refused', values: null },
  ]);
}

function failureProblems(saved: Record<string, unknown>) {
  const problems = saved['problems'] as { path: string; message: string }[];
  return problems.filter((problem) => problem.path === 'measure.failure_path');
}

async function namesReportedFailureInSave(db: Database): Promise<void> {
  const made = await scene(db, outputOf);
  await addSites(made);
  const measureId = newId();
  await accepted(made, 'save_measure', measureArgs(measureId, null, scored()));
  await trialOf(made, measureId, 1);
  expect((await observedOf(made, measureId)).map((each) => each.outcome)).toEqual([
    'ok',
    'ok',
    'ok',
  ]);
  const flagged = await accepted(made, 'save_measure', measureArgs(measureId, 1, scored('/error')));
  expect(failureProblems(flagged).map((problem) => problem.message)).toEqual([
    'In the output for Door43: the tool reported a failure at /error',
    'In the output for unfoldingWord: the tool reported a failure at /error',
  ]);
  const activated = await made.app.command(made.email, 'activate_measure', {
    measureId,
    expectedVersion: 2,
    dashboards: [],
  });
  expect(activated.body).toMatchObject({ reason: 'trial_unreadable' });
  await trialOf(made, measureId, 2);
  const again = await accepted(made, 'save_measure', measureArgs(measureId, 2, scored('/error')));
  expect(failureProblems(again)).toHaveLength(2);
}

describe.skipIf(!testServer)('ADR 0036 a failure the tool reports while exiting 0', () => {
  it('fails the observation with its reason and keeps no value, never a zero', () =>
    withAppDatabase(failsWhatToolReports));

  it('names in save_measure each trial output that reports a failure at failure_path', () =>
    withAppDatabase(namesReportedFailureInSave));
});

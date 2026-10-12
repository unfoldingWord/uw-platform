import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { Hub } from '@uw/harness';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { unitHub } from '../unit-hub.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { fixtureApp } from './testing/app-key.ts';
import { harnessId, imported, seedSoftwareHarness, withComments } from './testing/import-rig.ts';
import {
  firstRun,
  other,
  platform,
  programmed,
  sweepOnce,
  withOtherRepository,
} from './testing/sweep-rig.ts';

const tightLimit = 21;
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function recordingHub(): { readonly hub: Hub; readonly woken: string[] } {
  const woken: string[] = [];
  return { hub: { wake: async (id) => void woken.push(id), present: async () => false }, woken };
}

function twoRepositories() {
  const github = withComments(programmed());
  withOtherRepository(github);
  return github;
}

async function sweepWithWakes(db: Database, maxSubrequests: number) {
  const target = recordingHub();
  const unit = unitHub(target.hub);
  const github = twoRepositories();
  const options = { maxSubrequests, wakesOwed: () => unit.owed() };
  const { report } = await sweepOnce(db, app, { github, at: firstRun, hub: unit.hub, options });
  await unit.flush();
  return { report, woken: target.woken, spent: github.requests().length };
}

async function defersForOwedWakes(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const run = await sweepWithWakes(db, tightLimit);
  expect(run.report.repositories).toEqual([
    expect.objectContaining({ repo: platform, outcome: 'ok' }),
    expect.objectContaining({ repo: other, outcome: 'deferred', reason: 'budget_exhausted' }),
  ]);
  expect(run.woken).toEqual([harnessId]);
  expect(run.spent + run.woken.length).toBeLessThanOrEqual(tightLimit);
}

async function wakesEveryChange(db: Database, limit: number): Promise<void> {
  await seedSoftwareHarness(db);
  const run = await sweepWithWakes(db, limit);
  const changed = (await imported(db)).items.length > 0 ? [harnessId] : [];
  expect(run.woken).toEqual(changed);
  expect(run.spent + run.woken.length).toBeLessThanOrEqual(limit);
}

describe.skipIf(!testServer)(
  'WB-3 the sweep pays for the hub wakes it owes out of its subrequest bound',
  () => {
    it('WB-3 a sweep near its bound defers a repository rather than drop a wake it owes', () =>
      withAppDatabase(defersForOwedWakes));

    it.each([3, 9, 12, 17, 20, 23, 30])(
      'WB-3 wakes every harness it changed and stays inside a bound of %i with the wakes counted',
      (limit) => withAppDatabase((db) => wakesEveryChange(db, limit)),
    );
  },
);

import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPlatformPage } from '@uw/db/test-seed';
import { checkOnly } from '@uw/harness';
import { accepted, callerOf, ian } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import restPull from './fixtures/rest-pull.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import { head } from './testing/facts-fixtures.ts';
import {
  firstRun,
  nextRun,
  platform,
  programmed,
  pullPath,
  sweepOnce,
} from './testing/sweep-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function requested() {
  const github = programmed();
  github.on('GET', pullPath(7), {
    status: 200,
    body: { ...restPull, requested_reviewers: [{ login: 'uw-reviewer[bot]' }] },
  });
  return github;
}

async function checkOnlyOn(db: Database, shadow: boolean): Promise<string> {
  const harnessId = randomUUID();
  accepted(
    await kernelOn(db, { now: () => firstRun }).stages.activate(callerOf(await ian(db)), {
      harnessId,
      harnessKey: 'uw-platform-review',
      jdArea: '80-89',
      template: checkOnly,
      repository: platform,
      shadow,
      externalReviewerIdentities: [],
    }),
  );
  await seedPlatformPage(db, { id: randomUUID(), jdArea: '80-89', repositories: [platform] });
  return harnessId;
}

async function joinedItems(db: Database, harnessId: string) {
  const kernel = kernelOn(db, { now: () => nextRun });
  const items = await kernel.reads.inStage(callerOf(await ian(db)), {
    harnessId,
    stageKey: 'check',
    after: null,
    limit: 50,
  });
  return accepted(items).filter((item) => item.pullRequest !== null);
}

function outcomes(lines: readonly Record<string, unknown>[]): unknown[] {
  return lines.map((line) => line['outcome']);
}

describe.skipIf(!testServer)(
  'GL-3 the sweep joins a pull request that requests the Reviewer',
  () => {
    it('enqueues one item at Check with the head, once across two sweeps', () =>
      withAppDatabase(async (db) => {
        const harnessId = await checkOnlyOn(db, false);
        await sweepOnce(db, app, { github: requested(), at: firstRun });
        await sweepOnce(db, app, { github: requested(), at: nextRun });
        const items = await joinedItems(db, harnessId);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          pullRequest: { repo: platform, number: 7 },
          expectedHead: head,
          branchState: 'none',
        });
      }));

    it('logs no_harness_for_repo and enqueues nothing when the repository has no harness', () =>
      withAppDatabase(async (db) => {
        const { lines } = await sweepOnce(db, app, { github: requested(), at: firstRun });
        expect(outcomes(lines)).toContain('no_harness_for_repo');
      }));

    it('GL-4 records a shadow verdict for the joined pull request on a shadow harness', () =>
      withAppDatabase(async (db) => {
        await checkOnlyOn(db, true);
        const { lines } = await sweepOnce(db, app, { github: requested(), at: firstRun });
        expect(outcomes(lines)).toContain('shadow_verdict');
      }));
  },
);

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ghPrs, ghRepos } from '@uw/db/schema';
import checkRunCompleted from '../fixtures/check-run-completed.json' with { type: 'json' };
import pullRequestOpened from '../fixtures/pull-request-opened.json' with { type: 'json' };
import reviewSubmitted from '../fixtures/pull-request-review-submitted.json' with { type: 'json' };
import pullRequestSynchronize from '../fixtures/pull-request-synchronize.json' with { type: 'json' };
import { webhookBatch } from '../testing/batches.ts';
import {
  changedPaths,
  completedCheck,
  declaration,
  head,
  headRef,
  nextHead,
  openedPull,
  repo,
} from '../testing/facts-fixtures.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { openPullRequests, pullRequestFacts, repoByName } from './queries.ts';
import { emptyBatch } from './records.ts';
import { recordFiles, upsertFacts } from './upsert.ts';

const at = new Date('2026-10-02T09:00:00.000Z');
const ref = { repo: 'UnfoldingWord/UW-Platform', number: 7 };
const completed = webhookBatch('check_run', checkRunCompleted);

const expectedFacts = {
  ref: { repo: 'unfoldingWord/uw-platform', number: 7 },
  state: 'open',
  draft: false,
  head,
  headRef,
  checks: [
    {
      checkId: 9100000401,
      name: 'test',
      headSha: head,
      app: 'github-actions',
      conclusion: 'success',
    },
  ],
  reviews: [
    {
      reviewId: 9100000301,
      reviewer: 'uw-reviewer[bot]',
      commit: head,
      state: 'approved',
      provider: 'anthropic',
      submittedAt: new Date('2026-10-02T08:10:00.000Z'),
    },
  ],
  files: { head, paths: changedPaths },
  declaration,
  freshAt: at,
};

async function seeded(db: Database): Promise<void> {
  await upsertFacts(db, webhookBatch('pull_request', pullRequestOpened), at);
  await upsertFacts(db, webhookBatch('pull_request_review', reviewSubmitted), at);
  await upsertFacts(db, completed, at);
  const oldRun = { ...completedCheck, githubId: 9100000409, headSha: nextHead };
  await upsertFacts(db, { ...emptyBatch, repos: [repo], checkRuns: [oldRun] }, at);
  const files = { pullRequestId: openedPull.githubId, head, paths: changedPaths, problem: null };
  await recordFiles(db, files, at);
}

describe.skipIf(!testServer)('GH-2 the read model answers for a PR from its own tables', () => {
  it('answers the state, the head, the checks and reviews on it, the files and the declaration', () =>
    withAppDatabase(async (db) => {
      await seeded(db);
      expect(await pullRequestFacts(db, ref)).toEqual(expectedFacts);
    }));

  it('answers no files after a synchronize until the new head files are recorded', () =>
    withAppDatabase(async (db) => {
      await seeded(db);
      await upsertFacts(db, webhookBatch('pull_request', pullRequestSynchronize), at);
      const moved = await pullRequestFacts(db, ref);
      expect([moved?.head, moved?.files, moved?.checks]).toEqual([
        nextHead,
        null,
        [expect.objectContaining({ checkId: 9100000409, headSha: nextHead })],
      ]);
      const files = {
        pullRequestId: openedPull.githubId,
        head: nextHead,
        paths: ['a.ts'],
        problem: null,
      };
      await recordFiles(db, files, at);
      expect((await pullRequestFacts(db, ref))?.files).toEqual({ head: nextHead, paths: ['a.ts'] });
    }));

  it('answers no files and no declaration when what is stored is a problem', () =>
    withAppDatabase(async (db) => {
      await seeded(db);
      const files = {
        pullRequestId: openedPull.githubId,
        head,
        paths: null,
        problem: 'too_many_files',
      };
      await recordFiles(db, files, at);
      await db
        .update(ghPrs)
        .set({ declaration: { riskTier: 'none' } })
        .where(eq(ghPrs.githubId, openedPull.githubId));
      const facts = await pullRequestFacts(db, ref);
      expect([facts?.files, facts?.declaration]).toEqual([null, null]);
    }));

  it('answers null for a pull request it does not hold', () =>
    withAppDatabase(async (db) => {
      await seeded(db);
      expect(await pullRequestFacts(db, { ...ref, number: 8 })).toBeNull();
      expect(await pullRequestFacts(db, { repo: 'unfoldingWord/other', number: 7 })).toBeNull();
    }));
});

describe.skipIf(!testServer)('the read model lists a repository and its open pull requests', () => {
  it('finds a repository by name in any case, with its sweep watermark', () =>
    withAppDatabase(async (db) => {
      await seeded(db);
      expect(await repoByName(db, 'UNFOLDINGWORD/uw-platform')).toEqual({
        githubId: repo.githubId,
        sweptThrough: null,
      });
      await db.update(ghRepos).set({ sweptThrough: at });
      expect((await repoByName(db, repo.fullName))?.sweptThrough).toEqual(at);
      expect(await repoByName(db, 'unfoldingWord/other')).toBeNull();
    }));

  it('lists the open pull requests of a repository with whether their files are known', () =>
    withAppDatabase(async (db) => {
      await seeded(db);
      const closed = { ...openedPull, githubId: 9100000209, number: 9, state: 'closed' as const };
      await upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [closed] }, at);
      expect(await openPullRequests(db, repo.githubId)).toEqual([
        {
          repo: repo.fullName,
          githubId: openedPull.githubId,
          number: 7,
          head,
          base: 'main',
          filesKnown: true,
        },
      ]);
      expect(await openPullRequests(db, 9100000999)).toEqual([]);
    }));
});

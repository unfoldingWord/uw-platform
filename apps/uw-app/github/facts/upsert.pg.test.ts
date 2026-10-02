import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ghCheckRuns, ghIssues, ghMilestones, ghPrs, ghRepos, ghReviews } from '@uw/db/schema';
import checkRunCompleted from '../fixtures/check-run-completed.json' with { type: 'json' };
import issuesLabeled from '../fixtures/issues-labeled.json' with { type: 'json' };
import issuesUnlabeled from '../fixtures/issues-unlabeled.json' with { type: 'json' };
import pullRequestOpened from '../fixtures/pull-request-opened.json' with { type: 'json' };
import reviewDismissed from '../fixtures/pull-request-review-dismissed.json' with { type: 'json' };
import reviewSubmitted from '../fixtures/pull-request-review-submitted.json' with { type: 'json' };
import pullRequestSynchronize from '../fixtures/pull-request-synchronize.json' with { type: 'json' };
import { webhookBatch } from '../testing/batches.ts';
import { changedPaths, head, nextHead, openedPull } from '../testing/facts-fixtures.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { recordFiles, upsertFacts, type UpsertReport } from './upsert.ts';

const firstAt = new Date('2026-10-02T09:00:00.000Z');
const laterAt = new Date('2026-10-02T09:30:00.000Z');
const opened = webhookBatch('pull_request', pullRequestOpened);
const synchronized = webhookBatch('pull_request', pullRequestSynchronize);
const submitted = webhookBatch('pull_request_review', reviewSubmitted);
const dismissed = webhookBatch('pull_request_review', reviewDismissed);
const completed = webhookBatch('check_run', checkRunCompleted);

function inProgress() {
  const run = {
    ...checkRunCompleted.check_run,
    status: 'in_progress',
    conclusion: null,
    completed_at: null,
  };
  return webhookBatch('check_run', { ...checkRunCompleted, check_run: run });
}

function filesAt(at: string) {
  return { pullRequestId: openedPull.githubId, head: at, paths: changedPaths, problem: null };
}

async function prRow(db: Database) {
  const rows = await db.select().from(ghPrs);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new TypeError('no pull request row');
  return row;
}

async function reviewStates(db: Database): Promise<readonly string[]> {
  const rows = await db.select().from(ghReviews);
  return rows.map((row) => row.state);
}

async function checkStates(db: Database): Promise<readonly (string | null)[][]> {
  const rows = await db.select().from(ghCheckRuns);
  return rows.map((row) => [row.status, row.conclusion]);
}

function nothingRepaired(report: UpsertReport): boolean {
  return Object.values(report.repaired).every((count) => count === 0);
}

describe.skipIf(!testServer)(
  'GH-2 a redelivered or late GitHub fact never undoes a newer one',
  () => {
    it('upserts the same pull request twice into one row and repairs nothing the second time', () =>
      withAppDatabase(async (db) => {
        const first = await upsertFacts(db, opened, firstAt);
        const second = await upsertFacts(db, opened, laterAt);
        expect(first.repaired.pullRequests).toBe(1);
        expect(second.repaired.pullRequests).toBe(0);
        expect(second.repaired.repos).toBe(0);
        expect(await db.select().from(ghPrs)).toHaveLength(1);
      }));

    it('keeps the synchronize head when an older opened delivery arrives after it', () =>
      withAppDatabase(async (db) => {
        const first = await upsertFacts(db, synchronized, firstAt);
        const late = await upsertFacts(db, opened, laterAt);
        expect([first.repaired.pullRequests, late.repaired.pullRequests]).toEqual([1, 0]);
        const row = await prRow(db);
        expect(row.headSha).toBe(nextHead);
        expect(row.freshAt).toEqual(firstAt);
        expect(late.pullRequests).toEqual([
          expect.objectContaining({ head: nextHead, githubId: openedPull.githubId }),
        ]);
      }));

    it('keeps a dismissed review dismissed when the submitted delivery arrives again', () =>
      withAppDatabase(async (db) => {
        await upsertFacts(db, submitted, firstAt);
        await upsertFacts(db, dismissed, firstAt);
        const again = await upsertFacts(db, submitted, laterAt);
        expect(again.repaired.reviews).toBe(0);
        expect(await reviewStates(db)).toEqual(['dismissed']);
      }));

    it('keeps a completed check run completed when an older in-progress delivery arrives', () =>
      withAppDatabase(async (db) => {
        await upsertFacts(db, completed, firstAt);
        const late = await upsertFacts(db, inProgress(), laterAt);
        expect(late.repaired.checkRuns).toBe(0);
        expect(await checkStates(db)).toEqual([['completed', 'success']]);
      }));

    it('moves an in-progress check run to completed', () =>
      withAppDatabase(async (db) => {
        await upsertFacts(db, inProgress(), firstAt);
        const done = await upsertFacts(db, completed, laterAt);
        expect(done.repaired.checkRuns).toBe(1);
        expect(await checkStates(db)).toEqual([['completed', 'success']]);
      }));
  },
);

describe.skipIf(!testServer)(
  'GH-5 changed files are stored only against the head they were read at',
  () => {
    it('records files at the current head and refuses them at any other head', () =>
      withAppDatabase(async (db) => {
        await upsertFacts(db, opened, firstAt);
        expect(await recordFiles(db, filesAt(nextHead), laterAt)).toBe(false);
        expect((await prRow(db)).filesHead).toBeNull();
        expect(await recordFiles(db, filesAt(head), laterAt)).toBe(true);
        const row = await prRow(db);
        expect([row.filesHead, row.files, row.freshAt]).toEqual([head, changedPaths, laterAt]);
      }));

    it('clears the old head files when the head moves, and reports them unknown', () =>
      withAppDatabase(async (db) => {
        const before = await upsertFacts(db, opened, firstAt);
        await recordFiles(db, filesAt(head), firstAt);
        const moved = await upsertFacts(db, synchronized, laterAt);
        expect(before.pullRequests[0]?.filesKnown).toBe(false);
        expect(moved.pullRequests[0]?.filesKnown).toBe(false);
        const row = await prRow(db);
        expect([row.files, row.filesHead, row.filesProblem]).toEqual([null, null, null]);
      }));

    it('keeps the files when a delivery repeats the same head', () =>
      withAppDatabase(async (db) => {
        await upsertFacts(db, opened, firstAt);
        await recordFiles(db, filesAt(head), firstAt);
        const again = await upsertFacts(db, submitted, laterAt);
        expect(again.pullRequests[0]?.filesKnown).toBe(true);
        expect((await prRow(db)).filesHead).toBe(head);
      }));
  },
);

describe.skipIf(!testServer)('GH-2 the upsert reports what it stored', () => {
  it('reports the labels an issue had before the upsert', () =>
    withAppDatabase(async (db) => {
      const labelled = await upsertFacts(db, webhookBatch('issues', issuesLabeled), firstAt);
      const unlabelled = await upsertFacts(db, webhookBatch('issues', issuesUnlabeled), laterAt);
      expect(labelled.issues).toEqual([
        expect.objectContaining({
          repo: 'unfoldingWord/uw-platform',
          hadLabels: null,
          labels: ['harness'],
        }),
      ]);
      expect(unlabelled.issues).toEqual([
        expect.objectContaining({ hadLabels: ['harness'], labels: [] }),
      ]);
      expect(unlabelled.repaired.issues).toBe(1);
    }));

  it('reports every pull request in the batch as stored', () =>
    withAppDatabase(async (db) => {
      const report = await upsertFacts(db, opened, firstAt);
      expect(report.pullRequests).toEqual([
        {
          repo: 'unfoldingWord/uw-platform',
          githubId: openedPull.githubId,
          number: 7,
          head,
          base: 'main',
          filesKnown: false,
        },
      ]);
    }));
});

describe.skipIf(!testServer)(
  'GH-2 each read-model row carries the instant it was last confirmed',
  () => {
    it('stamps every written row with the given instant', () =>
      withAppDatabase(async (db) => {
        await upsertFacts(db, webhookBatch('issues', issuesLabeled), firstAt);
        await upsertFacts(db, submitted, firstAt);
        await upsertFacts(db, completed, firstAt);
        const tables = [ghRepos, ghMilestones, ghIssues, ghPrs, ghCheckRuns, ghReviews];
        for (const table of tables) {
          const rows = await db.select({ freshAt: table.freshAt }).from(table);
          expect(rows).toEqual([{ freshAt: firstAt }]);
        }
      }));

    it('moves the instant on an unchanged re-upsert without counting a repair', () =>
      withAppDatabase(async (db) => {
        await upsertFacts(db, webhookBatch('issues', issuesLabeled), firstAt);
        await upsertFacts(db, submitted, firstAt);
        const again = await upsertFacts(db, submitted, laterAt);
        expect(nothingRepaired(again)).toBe(true);
        expect(await db.select({ freshAt: ghRepos.freshAt }).from(ghRepos)).toEqual([
          { freshAt: laterAt },
        ]);
        expect((await prRow(db)).freshAt).toEqual(laterAt);
        expect(await db.select({ freshAt: ghReviews.freshAt }).from(ghReviews)).toEqual([
          { freshAt: laterAt },
        ]);
      }));

    it('inserts a new repository before the rows that reference it', () =>
      withAppDatabase(async (db) => {
        const report = await upsertFacts(db, submitted, firstAt);
        expect(report.repaired).toEqual({
          repos: 1,
          milestones: 0,
          issues: 0,
          pullRequests: 1,
          checkRuns: 0,
          reviews: 1,
          files: 0,
        });
        expect(
          await db.select({ id: ghRepos.githubId }).from(ghRepos).orderBy(asc(ghRepos.githubId)),
        ).toEqual([{ id: 9100000001 }]);
      }));
  },
);

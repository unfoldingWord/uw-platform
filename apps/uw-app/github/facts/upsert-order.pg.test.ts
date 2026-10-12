import { asc, sql } from 'drizzle-orm';
import type { Database } from '@uw/db/client';
import { pgErrorCode } from '@uw/db/errors';
import { describe, expect, it } from 'vitest';
import { ghCheckRuns, ghPrs } from '@uw/db/schema';
import restCheckRuns from '../fixtures/rest-check-runs.json' with { type: 'json' };
import {
  completedCheck,
  head,
  nextHead,
  openedPull,
  repo,
  submittedReview,
} from '../testing/facts-fixtures.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { checkRunsFromRest } from './normalise.ts';
import { emptyBatch, type FactBatch, type PullRequestRecord } from './records.ts';
import { upsertFacts } from './upsert.ts';

const at = new Date('2026-10-02T09:00:00.000Z');
const pullIds = [9100000201, 9100000202, 9100000203, 9100000204];

function pullsIn(order: readonly number[], headSha: string, minute: number): FactBatch {
  const pullRequests: PullRequestRecord[] = order.map((githubId, index) => ({
    ...openedPull,
    githubId,
    number: 7 + pullIds.indexOf(githubId),
    headSha,
    githubUpdatedAt: new Date(Date.UTC(2026, 9, 2, 8, minute, index)),
  }));
  return { ...emptyBatch, repos: [repo], pullRequests };
}

async function lockWaits(db: Database, waiting = 1): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const rows = await db.execute(
      sql`SELECT DISTINCT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.datname = current_database()`,
    );
    if (rows.length >= waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new TypeError('the upsert never waited for the held row');
}

async function lockable(db: Database, githubId: number): Promise<string> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM gh_prs WHERE github_id = ${githubId} FOR UPDATE NOWAIT`);
    });
    return 'free';
  } catch (error) {
    return pgErrorCode(error) === '55P03' ? 'held' : 'failed';
  }
}

async function holding(db: Database, githubId: number) {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked = (): void => undefined;
  const taken = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM gh_prs WHERE github_id = ${githubId} FOR UPDATE`);
    locked();
    await released;
  });
  await taken;
  return { release, done };
}

describe.skipIf(!testServer)('the upsert takes its row locks in GitHub id order', () => {
  it('locks the lower ids first however the batch lists them', () =>
    withAppDatabase(async (db) => {
      for (const githubId of [...pullIds].reverse()) {
        await upsertFacts(db, pullsIn([githubId], head, 0), at);
      }
      const [lowest, second, third, highest] = pullIds;
      const holder = await holding(db, second ?? 0);
      const upsert = upsertFacts(db, pullsIn([...pullIds].reverse(), nextHead, 5), at);
      await lockWaits(db);
      const seen = [
        await lockable(db, lowest ?? 0),
        await lockable(db, third ?? 0),
        await lockable(db, highest ?? 0),
      ];
      holder.release();
      await holder.done;
      await upsert;
      expect(seen).toEqual(['held', 'free', 'free']);
    }));
});

async function reviewsBesidePull(db: Database) {
  await upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [openedPull] }, at);
  const holder = await holding(db, openedPull.githubId);
  const newer = { ...openedPull, title: 'Show the board, renamed', githubUpdatedAt: at };
  const withPull = upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [newer] }, at);
  await lockWaits(db, 1);
  const reviewsOnly = upsertFacts(
    db,
    { ...emptyBatch, repos: [repo], reviews: [submittedReview] },
    at,
  );
  await lockWaits(db, 2);
  holder.release();
  await holder.done;
  const settled = await Promise.allSettled([withPull, reviewsOnly]);
  return settled.map((outcome) => outcome.status);
}

describe.skipIf(!testServer)('a batch that names a pull request only through its reviews', () => {
  it('waits for a batch holding that pull request instead of deadlocking with it', () =>
    withAppDatabase(async (db) => {
      expect(await reviewsBesidePull(db)).toEqual(['fulfilled', 'fulfilled']);
    }));
});

describe.skipIf(!testServer)('a later fact in the same batch or a re-completed check wins', () => {
  it('keeps the newer of two records for one pull request in a batch', () =>
    withAppDatabase(async (db) => {
      const newer = { ...openedPull, headSha: nextHead, githubUpdatedAt: at };
      await upsertFacts(
        db,
        { ...emptyBatch, repos: [repo], pullRequests: [newer, openedPull] },
        at,
      );
      const rows = await db.select({ head: ghPrs.headSha }).from(ghPrs);
      expect(rows).toEqual([{ head: nextHead }]);
    }));

  it('keeps the later completion of a check run when an older completion arrives after it', () =>
    withAppDatabase(async (db) => {
      const failed = {
        ...completedCheck,
        conclusion: 'failure' as const,
        completedAt: new Date('2026-10-02T08:10:00.000Z'),
      };
      await upsertFacts(db, { ...emptyBatch, repos: [repo], checkRuns: [failed] }, at);
      const late = await upsertFacts(
        db,
        { ...emptyBatch, repos: [repo], checkRuns: [completedCheck] },
        at,
      );
      expect(late.repaired.checkRuns).toBe(0);
      const rows = await db.select({ conclusion: ghCheckRuns.conclusion }).from(ghCheckRuns);
      expect(rows).toEqual([{ conclusion: 'failure' }]);
    }));
});

describe.skipIf(!testServer)('a check value outside the stored closed sets still lands', () => {
  it('stores a check run GitHub sent with an unknown status and conclusion', () =>
    withAppDatabase(async (db) => {
      const [run] = restCheckRuns.check_runs;
      const checkRuns = checkRunsFromRest(repo.githubId, [
        { ...run, id: 9100000402, status: 'warming_up', conclusion: null },
        { ...run, id: 9100000403, conclusion: 'startup_failure' },
      ]);
      const report = await upsertFacts(db, { ...emptyBatch, repos: [repo], checkRuns }, at);
      expect(report.repaired.checkRuns).toBe(2);
      const rows = await db
        .select({ status: ghCheckRuns.status, conclusion: ghCheckRuns.conclusion })
        .from(ghCheckRuns)
        .orderBy(asc(ghCheckRuns.githubId));
      expect(rows).toEqual([
        { status: 'pending', conclusion: null },
        { status: 'completed', conclusion: 'failure' },
      ]);
    }));
});

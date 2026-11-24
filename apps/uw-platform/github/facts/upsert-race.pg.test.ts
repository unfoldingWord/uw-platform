import { sql } from 'drizzle-orm';
import type { Database } from '@uw/db/client';
import { pgErrorCode } from '@uw/db/errors';
import { ghIssues } from '@uw/db/schema';
import { describe, expect, it } from 'vitest';
import { completedCheck, milestone, repo } from '../testing/facts-fixtures.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { emptyBatch, type FactBatch, type IssueRecord } from './records.ts';
import { upsertFacts } from './upsert.ts';

const at = new Date('2026-10-02T09:00:00.000Z');

const newIssue: IssueRecord = {
  githubId: 9100000142,
  repoId: repo.githubId,
  number: 42,
  title: 'A new issue',
  state: 'open',
  labels: ['harness'],
  milestoneId: null,
  githubUpdatedAt: new Date('2026-10-02T08:00:00.000Z'),
  subIssues: 0,
  doneWhen: ['A new issue ships.'],
  blockedBy: [],
};

const delivery: FactBatch = { ...emptyBatch, repos: [repo], issues: [newIssue] };

type Holder = { readonly pid: number; readonly release: () => void; readonly done: Promise<void> };

async function holding(db: Database, table: 'gh_check_runs' | 'gh_milestones', githubId: number) {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked = (pid: number): void => void pid;
  const taken = new Promise<number>((resolve) => {
    locked = resolve;
  });
  const done = db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT 1 FROM ${sql.identifier(table)} WHERE github_id = ${githubId} FOR UPDATE`,
    );
    const [row] = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
    locked(Number(row?.['pid']));
    await released;
  });
  const holder: Holder = { pid: await taken, release, done };
  return holder;
}

async function until(db: Database, count: () => ReturnType<typeof sql>, wanted: number) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [row] = await db.execute(count());
    if (Number(row?.['n']) >= wanted) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new TypeError('the deliveries never queued as the race needs');
}

const blockedBy = (db: Database, pid: number) =>
  until(
    db,
    () =>
      sql`SELECT count(*) AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`,
    1,
  );

const waiting = (db: Database, wanted: number) =>
  until(
    db,
    () =>
      sql`SELECT count(DISTINCT l.pid) AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.datname = current_database()`,
    wanted,
  );

async function threeFirstDeliveries(db: Database) {
  await upsertFacts(db, { ...emptyBatch, repos: [repo], milestones: [milestone] }, at);
  await upsertFacts(db, { ...emptyBatch, repos: [repo], checkRuns: [completedCheck] }, at);
  const check = await holding(db, 'gh_check_runs', completedCheck.githubId);
  const first = upsertFacts(db, { ...delivery, checkRuns: [completedCheck] }, at);
  await blockedBy(db, check.pid);
  const marker = await holding(db, 'gh_milestones', milestone.githubId);
  const second = upsertFacts(db, { ...delivery, milestones: [milestone] }, at);
  await waiting(db, 2);
  check.release();
  await Promise.all([check.done, first]);
  await blockedBy(db, marker.pid);
  const third = upsertFacts(db, delivery, at);
  await waiting(db, 2);
  marker.release();
  await marker.done;
  return Promise.allSettled([second, third]);
}

function outcomeOf(outcome: PromiseSettledResult<unknown>) {
  return outcome.status === 'fulfilled' ? 'committed' : pgErrorCode(outcome.reason);
}

describe.skipIf(!testServer)('three first deliveries of one new issue', () => {
  it('queue on the repository instead of deadlocking on the issue row', () =>
    withAppDatabase(async (db) => {
      const settled = await threeFirstDeliveries(db);
      expect(settled.map(outcomeOf)).toEqual(['committed', 'committed']);
      const rows = await db.select({ githubId: ghIssues.githubId }).from(ghIssues);
      expect(rows).toEqual([{ githubId: newIssue.githubId }]);
    }));
});

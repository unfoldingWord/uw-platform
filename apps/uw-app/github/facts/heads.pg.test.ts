import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ghPrs } from '@uw/db/schema';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { base, head, nextHead, openedPull, repo } from '../testing/facts-fixtures.ts';
import { recordFiles } from './heads.ts';
import { pullRequestChanges, pullRequestFacts } from './queries.ts';
import { emptyBatch } from './records.ts';
import { upsertFacts } from './upsert.ts';

const at = new Date('2026-10-15T09:00:00.000Z');
const later = new Date('2026-10-15T09:05:00.000Z');
const patch = '1'.repeat(64);
const ref = { repo: repo.fullName, number: openedPull.number };
const closes = [{ repo: repo.fullName, number: 12 }];
const commit = { sha: head, merge: false, skipCi: false, closes };
const atHead = { pullRequestId: openedPull.githubId, paths: ['apps/uw-app/board.tsx'] };

async function stored(db: Database): Promise<void> {
  const pull = { ...openedPull, closes };
  await upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [pull] }, at);
  const files = { ...atHead, head, base, problem: null };
  await recordFiles(db, { ...files, behindBy: 0, patchId: patch, commits: [commit] });
}

async function readsTheComparison(db: Database): Promise<void> {
  await stored(db);
  const facts = await pullRequestFacts(db, ref);
  expect(facts?.closes).toEqual(closes);
  expect(facts?.comparison).toEqual({
    head,
    base,
    behindBy: 0,
    patchId: patch,
    commits: [commit],
    patchIds: { [head]: patch },
  });
}

async function clearsItOnANewHeadAndKeepsTheHistory(db: Database): Promise<void> {
  await stored(db);
  const moved = { ...openedPull, headSha: nextHead, closes: [], githubUpdatedAt: later };
  await upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [moved] }, later);
  const facts = await pullRequestFacts(db, ref);
  expect(facts?.closes).toEqual([]);
  expect(facts?.comparison).toBeNull();
  const files = { ...atHead, head: nextHead, base, problem: null };
  await recordFiles(db, { ...files, behindBy: 1, patchId: patch, commits: null });
  const after = await pullRequestFacts(db, ref);
  expect(after?.comparison).toMatchObject({
    head: nextHead,
    behindBy: 1,
    commits: null,
    patchIds: { [head]: patch, [nextHead]: patch },
  });
}

async function readsNothingRecordedAgainstAnotherBase(db: Database): Promise<void> {
  await stored(db);
  await db
    .update(ghPrs)
    .set({ filesBase: nextHead })
    .where(eq(ghPrs.githubId, openedPull.githubId));
  expect((await pullRequestFacts(db, ref))?.comparison).toBeNull();
  await db.update(ghPrs).set({ filesBase: base, filesHead: nextHead });
  expect((await pullRequestFacts(db, ref))?.comparison).toBeNull();
}

async function readsUnknownClosingReferences(db: Database): Promise<void> {
  await stored(db);
  await db.update(ghPrs).set({ closes: [{ repo: 'no-owner', number: 0 }] });
  expect((await pullRequestFacts(db, ref))?.closes).toBeNull();
}

async function readsAgainFilesRecordedWithoutAComparison(db: Database): Promise<void> {
  await stored(db);
  const known = await pullRequestChanges(db, eq(ghPrs.githubId, openedPull.githubId));
  expect(known.map((change) => change.filesKnown)).toEqual([true]);
  await db.update(ghPrs).set({ behindBy: null, patchId: null, headCommits: null });
  const unread = await pullRequestChanges(db, eq(ghPrs.githubId, openedPull.githubId));
  expect(unread.map((change) => change.filesKnown)).toEqual([false]);
}

describe.skipIf(!testServer)('the base comparison in the read model', () => {
  it('SR-1 SR-2 reads the closing references and the comparison recorded at the head', () =>
    withAppDatabase(readsTheComparison));
  it('SR-2 clears the comparison when the head moves and keeps the patch id of every head', () =>
    withAppDatabase(clearsItOnANewHeadAndKeepsTheHistory));
  it('SR-1 reads no comparison recorded at another head or against another base', () =>
    withAppDatabase(readsNothingRecordedAgainstAnotherBase));
  it('SR-1 reads closing references it cannot parse as unknown, not as none', () =>
    withAppDatabase(readsUnknownClosingReferences));
  it('SR-1 reads the files again where they were recorded without a comparison', () =>
    withAppDatabase(readsAgainFilesRecordedWithoutAComparison));
});

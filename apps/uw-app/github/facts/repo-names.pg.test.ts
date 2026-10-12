import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ghRepos } from '@uw/db/schema';
import { repo } from '../testing/facts-fixtures.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import type { FactBatch, RepoRecord } from './records.ts';
import { repoByName } from './queries.ts';
import { upsertFacts } from './upsert.ts';

const firstAt = new Date('2026-10-02T09:00:00.000Z');
const laterAt = new Date('2026-10-02T09:30:00.000Z');
const original: RepoRecord = repo;
const successor: RepoRecord = { ...repo, githubId: 9100000002 };

function reposOnly(...repos: RepoRecord[]): FactBatch {
  return {
    repos,
    milestones: [],
    issues: [],
    pullRequests: [],
    checkRuns: [],
    reviews: [],
    files: [],
  };
}

async function names(db: Database): Promise<readonly [number, string][]> {
  const rows = await db
    .select({ id: ghRepos.githubId, name: ghRepos.fullName })
    .from(ghRepos)
    .orderBy(asc(ghRepos.githubId));
  return rows.map((row) => [row.id, row.name]);
}

describe.skipIf(!testServer)('GH-2 a repository name taken over by another repository', () => {
  it('moves the name to the new repository and keeps the old row under a placeholder', () =>
    withAppDatabase(async (db) => {
      await upsertFacts(db, reposOnly(original), firstAt);
      const report = await upsertFacts(db, reposOnly(successor), laterAt);
      expect(report.repaired.repos).toBe(1);
      expect(await names(db)).toEqual([
        [original.githubId, `unfoldingWord/moved.${original.githubId}`],
        [successor.githubId, 'unfoldingWord/uw-platform'],
      ]);
      expect(await repoByName(db, 'UnfoldingWord/UW-Platform')).toMatchObject({
        githubId: successor.githubId,
      });
    }));

  it('gives the old repository its new name when an event carries the rename', () =>
    withAppDatabase(async (db) => {
      await upsertFacts(db, reposOnly(original), firstAt);
      await upsertFacts(
        db,
        reposOnly({ ...successor, fullName: 'UnfoldingWord/UW-Platform' }),
        firstAt,
      );
      const renamed = { ...original, fullName: 'unfoldingWord/uw-platform-archive' };
      await upsertFacts(db, reposOnly(renamed), laterAt);
      expect(await names(db)).toEqual([
        [original.githubId, 'unfoldingWord/uw-platform-archive'],
        [successor.githubId, 'UnfoldingWord/UW-Platform'],
      ]);
    }));

  it('swaps two names within one batch', () =>
    withAppDatabase(async (db) => {
      const other = { ...successor, fullName: 'unfoldingWord/other' };
      await upsertFacts(db, reposOnly(original, other), firstAt);
      const swapped = reposOnly(
        { ...original, fullName: other.fullName },
        { ...other, fullName: original.fullName },
      );
      await upsertFacts(db, swapped, laterAt);
      expect(await names(db)).toEqual([
        [original.githubId, 'unfoldingWord/other'],
        [successor.githubId, 'unfoldingWord/uw-platform'],
      ]);
    }));
});

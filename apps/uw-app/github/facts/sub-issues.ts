import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import { advisoryLock, githubRepoKey } from '@uw/db/advisory-locks';
import type { Database, Executor } from '@uw/db/client';
import { ghIssues, ghRepos } from '@uw/db/schema';
import { issueChangeOf } from './issues.ts';
import type { IssueChange } from './records.ts';

const UNREAD_LIMIT = 20;

export type SubIssueList = {
  readonly repoId: number;
  readonly parentId: number;
  readonly children: readonly number[];
};

function droppedFrom(list: SubIssueList) {
  const ofParent = eq(ghIssues.parentIssueId, list.parentId);
  if (list.children.length === 0) return ofParent;
  return and(ofParent, notInArray(ghIssues.githubId, [...list.children]));
}

export function recordSubIssues(db: Database, list: SubIssueList): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(advisoryLock(githubRepoKey(list.repoId)));
    await tx
      .update(ghIssues)
      .set({ parentIssueId: null, parentPosition: null })
      .where(droppedFrom(list));
    let recorded = 0;
    for (const [position, githubId] of list.children.entries()) {
      const rows = await tx
        .update(ghIssues)
        .set({ parentIssueId: list.parentId, parentPosition: position })
        .where(and(eq(ghIssues.githubId, githubId), eq(ghIssues.repoId, list.repoId)))
        .returning({ githubId: ghIssues.githubId });
      recorded += rows.length;
    }
    return recorded;
  });
}

export async function clearSubIssues(db: Executor, parentIds: readonly number[]): Promise<void> {
  if (parentIds.length === 0) return;
  await db
    .update(ghIssues)
    .set({ parentIssueId: null, parentPosition: null })
    .where(inArray(ghIssues.parentIssueId, [...parentIds]));
}

export async function epicsAwaitingSubIssues(
  db: Executor,
  repoId: number,
): Promise<readonly IssueChange[]> {
  const rows = await db
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(
      and(
        eq(ghIssues.repoId, repoId),
        eq(ghIssues.state, 'open'),
        gt(ghIssues.subIssues, 0),
        sql`${ghIssues.subIssues} <> (SELECT count(*) FROM gh_issues AS child WHERE child.parent_issue_id = ${ghIssues.githubId})`,
      ),
    )
    .orderBy(asc(ghIssues.githubId))
    .limit(UNREAD_LIMIT);
  return rows.map(({ issue, repo }) => issueChangeOf(issue, repo, null));
}

import { asc, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '@uw/db/client';
import { ghIssues, ghRepos } from '@uw/db/schema';
import type { IssueChange } from './records.ts';

type IssueRow = typeof ghIssues.$inferSelect;

export function issueChangeOf(
  issue: IssueRow,
  repo: string,
  had: readonly string[] | null,
): IssueChange {
  return {
    repo,
    githubId: issue.githubId,
    number: issue.number,
    title: issue.title,
    open: issue.state === 'open',
    labels: issue.labels,
    hadLabels: had,
    githubUpdatedAt: issue.githubUpdatedAt,
    subIssues: issue.subIssues,
    doneWhen: issue.doneWhen,
    blockedBy: issue.blockedBy,
  };
}

export async function lockedLabels(tx: Transaction, ids: readonly number[]) {
  if (ids.length === 0) return new Map<number, readonly string[]>();
  const rows = await tx
    .select({ githubId: ghIssues.githubId, labels: ghIssues.labels })
    .from(ghIssues)
    .where(inArray(ghIssues.githubId, [...ids]))
    .orderBy(asc(ghIssues.githubId))
    .for('update');
  return new Map(rows.map((row) => [row.githubId, row.labels]));
}

export async function storedIssues(
  tx: Transaction,
  ids: readonly number[],
  had: ReadonlyMap<number, readonly string[]>,
): Promise<readonly IssueChange[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(inArray(ghIssues.githubId, [...ids]))
    .orderBy(asc(ghIssues.githubId));
  return rows.map(({ issue, repo }) => issueChangeOf(issue, repo, had.get(issue.githubId) ?? null));
}

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { ghIssues, ghRepos } from '@uw/db/schema';
import type { EpicFacts, IssueFact, IssueKey } from '@uw/harness';

type IssueRow = typeof ghIssues.$inferSelect;

function factOf(row: IssueRow, repo: string): IssueFact {
  return {
    issue: { repo, number: row.number, githubId: row.githubId },
    title: row.title,
    open: row.state === 'open',
    doneWhen: row.doneWhen,
    blockedBy: row.blockedBy,
  };
}

export async function epicFacts(db: Executor, key: IssueKey): Promise<EpicFacts | null> {
  const [found] = await db
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(
      and(sql`lower(${ghRepos.fullName}) = lower(${key.repo})`, eq(ghIssues.number, key.number)),
    )
    .limit(1);
  if (found === undefined) return null;
  const children = await db
    .select()
    .from(ghIssues)
    .where(eq(ghIssues.parentIssueId, found.issue.githubId))
    .orderBy(asc(ghIssues.parentPosition), asc(ghIssues.githubId));
  return {
    epic: factOf(found.issue, found.repo),
    subIssueCount: found.issue.subIssues,
    subIssues: children.map((row) => factOf(row, found.repo)),
  };
}

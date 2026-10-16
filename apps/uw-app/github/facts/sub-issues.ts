import { and, eq, notInArray } from 'drizzle-orm';
import { advisoryLock, githubRepoKey } from '@uw/db/advisory-locks';
import type { Database } from '@uw/db/client';
import { ghIssues } from '@uw/db/schema';

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

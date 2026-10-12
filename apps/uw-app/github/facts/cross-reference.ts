import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '@uw/db/client';
import { ghIssues } from '@uw/db/schema';

const claimLeaseMs = 10 * 60_000;

export async function claimCrossReference(
  db: Database,
  githubId: number,
  at: Date,
): Promise<boolean> {
  const lapsed = new Date(at.getTime() - claimLeaseMs);
  const rows = await db
    .update(ghIssues)
    .set({ xrefClaimedAt: at })
    .where(
      and(
        eq(ghIssues.githubId, githubId),
        isNull(ghIssues.xrefCommentId),
        or(isNull(ghIssues.xrefClaimedAt), lt(ghIssues.xrefClaimedAt, lapsed)),
      ),
    )
    .returning({ githubId: ghIssues.githubId });
  return rows.length > 0;
}

export async function recordCrossReference(
  db: Database,
  githubId: number,
  commentId: number,
): Promise<void> {
  await db
    .update(ghIssues)
    .set({ xrefCommentId: commentId })
    .where(and(eq(ghIssues.githubId, githubId), isNull(ghIssues.xrefCommentId)));
}

export async function releaseCrossReference(
  db: Database,
  githubId: number,
  claimedAt: Date,
): Promise<void> {
  await db
    .update(ghIssues)
    .set({ xrefClaimedAt: null })
    .where(
      and(
        eq(ghIssues.githubId, githubId),
        isNull(ghIssues.xrefCommentId),
        eq(ghIssues.xrefClaimedAt, claimedAt),
      ),
    );
}

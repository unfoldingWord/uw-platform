import { and, eq, sql } from 'drizzle-orm';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { ghPrs } from '@uw/db/schema';
import type { FilesRecord } from './records.ts';

const PATCH_HISTORY = 100;

function patchIdsAfter(files: FilesRecord) {
  if (files.patchId === null) return sql`${ghPrs.patchIds}`;
  const added = JSON.stringify({ [files.head]: files.patchId });
  return sql`CASE WHEN (SELECT count(*) FROM jsonb_object_keys(${ghPrs.patchIds})) >= ${PATCH_HISTORY}
    THEN ${added}::jsonb ELSE ${ghPrs.patchIds} || ${added}::jsonb END`;
}

async function recordFilesIn(db: Executor, files: FilesRecord): Promise<boolean> {
  const at = and(
    eq(ghPrs.githubId, files.pullRequestId),
    eq(ghPrs.headSha, files.head),
    eq(ghPrs.baseSha, files.base),
  );
  const rows = await db
    .update(ghPrs)
    .set({
      files: files.paths,
      filesHead: files.head,
      filesBase: files.base,
      filesProblem: files.problem,
      behindBy: files.behindBy,
      patchId: files.patchId,
      headCommits: files.commits,
      patchIds: patchIdsAfter(files),
    })
    .where(at)
    .returning({ githubId: ghPrs.githubId });
  return rows.length > 0;
}

export async function recordAllFiles(tx: Transaction, files: readonly FilesRecord[]) {
  let landed = 0;
  const ordered = [...files].sort((a, b) => a.pullRequestId - b.pullRequestId);
  for (const record of ordered) if (await recordFilesIn(tx, record)) landed += 1;
  return landed;
}

export function recordFiles(db: Database, files: FilesRecord): Promise<boolean> {
  return recordFilesIn(db, files);
}

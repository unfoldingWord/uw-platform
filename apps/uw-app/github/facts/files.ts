import type { Database } from '@uw/db/client';
import type { GitHubReads } from '../client.ts';
import type { GitHubResult } from '../failures.ts';
import { filesFromRest } from './normalise.ts';
import type { PullRequestChange } from './queries.ts';
import { recordFiles } from './upsert.ts';

export async function fetchFilesAtHead(
  reads: GitHubReads,
  db: Database,
  pull: PullRequestChange,
): Promise<GitHubResult<boolean>> {
  const answer = await reads.changedFiles(pull.repo, pull.baseSha, pull.head);
  if (!answer.ok) return answer;
  const compared = { head: pull.head, base: pull.baseSha };
  const files = filesFromRest(pull.githubId, compared, answer.value);
  return { ok: true, value: await recordFiles(db, files) };
}

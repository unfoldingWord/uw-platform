import { closingReferences, fullSha, hasSkipCiMarker, type HeadCommit } from '@uw/harness';
import type { Compared } from '../client.ts';
import { compareCommitSchema } from '../payloads.ts';
import { patchIdOf } from './patch-id.ts';
import type { HeadFacts } from './records.ts';

const HEAD_COMMIT_LIMIT = 100;

function commitsOf(listed: readonly unknown[], repository: string): readonly HeadCommit[] | null {
  const parsed = compareCommitSchema.array().max(HEAD_COMMIT_LIMIT).safeParse(listed);
  if (!parsed.success) return null;
  const commits: HeadCommit[] = [];
  for (const entry of parsed.data) {
    const sha = fullSha(entry.sha);
    if (sha === null) return null;
    const { message } = entry.commit;
    const closes = [...closingReferences(message, repository)];
    commits.push({
      sha,
      merge: entry.parents.length > 1,
      skipCi: hasSkipCiMarker(message),
      closes,
    });
  }
  return commits;
}

export async function headFactsOf(compared: Compared, repository: string): Promise<HeadFacts> {
  return {
    behindBy: compared.behindBy,
    patchId: compared.files === 'too_many_files' ? null : await patchIdOf(compared.files),
    commits: compared.commits === null ? null : commitsOf(compared.commits, repository),
  };
}

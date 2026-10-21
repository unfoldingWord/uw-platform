import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { ghPrs, ghRepos } from '@uw/db/schema';
import type { PullRequestAuthor, PullRequestRef } from '@uw/harness';

const AUTHORS_LIMIT = 5000;

function byRepository(refs: readonly PullRequestRef[]): ReadonlyMap<string, readonly number[]> {
  const grouped = new Map<string, number[]>();
  for (const ref of refs.slice(0, AUTHORS_LIMIT)) {
    const repo = ref.repo.toLowerCase();
    const numbers = grouped.get(repo) ?? [];
    numbers.push(ref.number);
    grouped.set(repo, numbers);
  }
  return grouped;
}

async function authorsIn(
  db: Executor,
  repo: string,
  numbers: readonly number[],
): Promise<readonly PullRequestAuthor[]> {
  const rows = await db
    .select({ repo: ghRepos.fullName, number: ghPrs.number, author: ghPrs.authorLogin })
    .from(ghPrs)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghPrs.repoId))
    .where(
      and(
        sql`lower(${ghRepos.fullName}) = ${repo}`,
        inArray(ghPrs.number, [...numbers]),
        isNotNull(ghPrs.authorLogin),
      ),
    );
  return rows.flatMap((row) =>
    row.author === null
      ? []
      : [{ ref: { repo: row.repo, number: row.number }, author: row.author }],
  );
}

export async function pullRequestAuthors(
  db: Executor,
  refs: readonly PullRequestRef[],
): Promise<readonly PullRequestAuthor[]> {
  const found: PullRequestAuthor[] = [];
  for (const [repo, numbers] of byRepository(refs)) {
    found.push(...(await authorsIn(db, repo, numbers)));
  }
  return found;
}

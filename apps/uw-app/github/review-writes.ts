import { z } from 'zod';
import type { ReviewVerdict } from '@uw/contracts';
import type { GitHubAppConfig } from './app-config.ts';
import type { GitHubResult } from './failures.ts';
import { isCount, isFullSha, refusedInput } from './inputs.ts';
import { openSession, shaped } from './session.ts';
import type { GitHubTransport } from './transport.ts';

export type ReviewGitHub = {
  readonly apps: ReadonlyMap<string, GitHubAppConfig>;
  readonly transport: GitHubTransport;
};

type ReviewPost = {
  readonly head: string;
  readonly verdict: ReviewVerdict;
  readonly body: string;
};

export type ReviewWrites = {
  post(
    repo: string,
    number: number,
    review: ReviewPost,
  ): Promise<GitHubResult<{ readonly reviewId: number }>>;
};

const reviewPermissions = { pull_requests: 'write', metadata: 'read' } as const;
const events = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES' } as const;
const posted = z
  .object({ id: z.number().int().positive() })
  .transform(({ id }) => ({ reviewId: id }));

export function createReviewWrites(
  config: GitHubAppConfig,
  transport: GitHubTransport,
): ReviewWrites {
  const session = openSession(config, transport, reviewPermissions);
  return {
    post: async (repo, number, review) => {
      if (!isCount(number) || !isFullSha(review.head)) return refusedInput;
      const answer = await session.request(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        {
          pull_number: number,
          commit_id: review.head,
          event: events[review.verdict],
          body: review.body,
        },
        repo,
      );
      return answer.ok ? shaped(posted, answer.value) : answer;
    },
  };
}

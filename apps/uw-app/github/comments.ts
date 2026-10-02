import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import type { GitHubResult } from './failures.ts';
import { refusedInput, openSession, repositoryOf, shaped } from './session.ts';
import type { GitHubTransport } from './transport.ts';

const created = z.object({ id: z.number().int() }).transform(({ id }) => ({ id }));

export function createIssueComments(config: GitHubAppConfig, transport: GitHubTransport) {
  const session = openSession(config, transport);
  return {
    comment: async (
      repo: string,
      number: number,
      body: string,
    ): Promise<GitHubResult<{ readonly id: number }>> => {
      const repository = repositoryOf(repo);
      if (!repository) return refusedInput;
      const answer = await session.request(
        'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
        {
          ...repository,
          issue_number: number,
          body,
        },
      );
      return answer.ok ? shaped(created, answer.value) : answer;
    },
  };
}

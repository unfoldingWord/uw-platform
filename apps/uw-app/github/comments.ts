import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import type { GitHubResult } from './failures.ts';
import { isCount, refusedInput } from './inputs.ts';
import { openSession, shaped } from './session.ts';
import type { GitHubTransport } from './transport.ts';

const commentPermissions = { issues: 'write', metadata: 'read' } as const;
const created = z.object({ id: z.number().int() }).transform(({ id }) => ({ id }));

export function createIssueComments(config: GitHubAppConfig, transport: GitHubTransport) {
  const session = openSession(config, transport, commentPermissions);
  return {
    comment: async (
      repo: string,
      number: number,
      body: string,
    ): Promise<GitHubResult<{ readonly id: number }>> => {
      if (!isCount(number)) return refusedInput;
      const answer = await session.request(
        'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
        { issue_number: number, body },
        repo,
      );
      return answer.ok ? shaped(created, answer.value) : answer;
    },
  };
}

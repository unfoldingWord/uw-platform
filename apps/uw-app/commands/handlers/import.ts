import { sameRepository } from '@uw/harness';
import { commandHandler } from '../handler.ts';

export const importCommand = commandHandler({
  name: 'import',
  action: 'write',
  run: async (context, body) => {
    if (!sameRepository(body.repository, context.harness?.repository ?? null)) {
      return { ok: false, reason: 'not_permitted' };
    }
    const issue = await context.githubIssues.byNumber(body.repository, body.number);
    if (issue === null) return { ok: false, reason: 'issue_not_found' };
    return context.importIssue(issue);
  },
});

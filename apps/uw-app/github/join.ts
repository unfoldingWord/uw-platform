import type { Logger } from '@uw/core/log';
import { requestsPlatformReviewer } from '@uw/harness';
import type { GitHubDeps } from './deps.ts';
import type { PullRequestChange } from './facts/queries.ts';
import { callerFor } from './import.ts';

function fieldsOf(change: PullRequestChange) {
  return { repository: change.repo, pull_request: change.number };
}

async function joinOne(deps: GitHubDeps, change: PullRequestChange, logger: Logger) {
  const joined = await deps.kernel.items.join(callerFor(logger), {
    pullRequest: { repo: change.repo, number: change.number },
    head: change.head,
    title: change.title,
    requestedReviewers: change.requestedReviewers,
  });
  if (joined.status !== 'accepted') {
    logger.info('pull request not joined', { outcome: joined.reason, ...fieldsOf(change) });
    return;
  }
  const outcome = joined.value.created ? 'pull_request_joined' : 'pull_request_already_joined';
  logger.info('pull request joined', { outcome, ...fieldsOf(change) });
}

async function shadowOne(deps: GitHubDeps, change: PullRequestChange, logger: Logger) {
  const pullRequest = { repo: change.repo, number: change.number };
  const recorded = await deps.kernel.gates.recordShadowVerdicts(callerFor(logger), { pullRequest });
  if (recorded.status !== 'accepted') {
    logger.warn('shadow verdict not recorded', { outcome: recorded.reason, ...fieldsOf(change) });
    return;
  }
  if (recorded.value.length > 0) {
    logger.info('shadow verdict recorded', { outcome: 'shadow_verdict', ...fieldsOf(change) });
  }
}

export async function followPullRequestJoins(
  deps: GitHubDeps,
  changes: readonly PullRequestChange[],
  logger: Logger,
): Promise<void> {
  for (const change of changes) {
    if (change.open && requestsPlatformReviewer(change.requestedReviewers)) {
      await joinOne(deps, change, logger);
    }
    await shadowOne(deps, change, logger);
  }
}

import type { Logger } from '@uw/core/log';
import type { GitHubReads } from './client.ts';
import type { GitHubDeps } from './deps.ts';
import { subIssuesFromRest } from './facts/normalise.ts';
import { repoByName } from './facts/queries.ts';
import { emptyBatch, type IssueChange } from './facts/records.ts';
import { recordSubIssues } from './facts/sub-issues.ts';
import { upsertFacts } from './facts/upsert.ts';

async function followOne(
  deps: GitHubDeps,
  reads: GitHubReads,
  change: IssueChange,
  logger: Logger,
): Promise<void> {
  const fields = { repository: change.repo, issue: change.number };
  const repo = await repoByName(deps.db, change.repo);
  if (repo === null) return;
  const listed = await reads.subIssues(change.repo, change.number);
  if (!listed.ok) {
    const { failure, status } = listed;
    logger.warn('sub-issues not read', {
      outcome: 'sub_issues_not_read',
      ...fields,
      failure,
      status,
    });
    return;
  }
  const named = { githubId: repo.githubId, fullName: change.repo };
  const children = subIssuesFromRest(named, listed.value);
  await upsertFacts(deps.db, { ...emptyBatch, issues: children }, deps.now());
  const recorded = await recordSubIssues(deps.db, {
    repoId: repo.githubId,
    parentId: change.githubId,
    children: children.map((child) => child.githubId),
  });
  logger.info('sub-issues recorded', {
    outcome: 'sub_issues_recorded',
    ...fields,
    listed: listed.value.length,
    recorded,
  });
}

export async function followSubIssues(
  deps: GitHubDeps,
  changes: readonly IssueChange[],
  logger: Logger,
): Promise<void> {
  const epics = changes.filter((change) => change.subIssues > 0);
  if (epics.length === 0) return;
  if (deps.client === null) {
    logger.warn('sub-issues not read: GitHub is not configured', {
      outcome: 'github_not_configured',
    });
    return;
  }
  const reads = deps.client.reads();
  for (const change of epics) await followOne(deps, reads, change, logger);
}

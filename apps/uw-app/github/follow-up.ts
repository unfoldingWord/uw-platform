import type { Logger } from '@uw/core/log';
import { unitOfWork, type GitHubDeps } from './deps.ts';
import { fetchFilesAtHead } from './facts/files.ts';
import type { UpsertReport } from './facts/upsert.ts';
import { followIssue } from './import.ts';
import { followPullRequestJoins } from './join.ts';
import { followSubIssues } from './sub-issues.ts';

async function followPullRequests(deps: GitHubDeps, report: UpsertReport, logger: Logger) {
  const unknown = report.pullRequests.filter((pull) => !pull.filesKnown);
  if (unknown.length === 0) return;
  if (deps.client === null) {
    logger.warn('changed files not read: GitHub is not configured', {
      outcome: 'github_not_configured',
    });
    return;
  }
  const reads = deps.client.reads();
  for (const pull of unknown) {
    const fetched = await fetchFilesAtHead(reads, deps.db, pull);
    if (!fetched.ok) {
      logger.warn('changed files not read from GitHub', {
        outcome: 'files_not_fetched',
        pull_request: pull.number,
        failure: fetched.failure,
        status: fetched.status,
      });
    }
  }
}

export async function followUpserts(
  deps: GitHubDeps,
  report: UpsertReport,
  logger: Logger,
): Promise<void> {
  const unit = unitOfWork(deps);
  await followPullRequests(unit, report, logger);
  await followPullRequestJoins(unit, report.pullRequests, logger);
  await followSubIssues(unit, report.issues, logger);
  for (const change of report.issues) await followIssue(unit, change, logger);
}

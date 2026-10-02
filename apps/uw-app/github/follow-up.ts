import type { Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { Kernel } from '@uw/harness';
import { fetchFilesAtHead } from './facts/files.ts';
import type { UpsertReport } from './facts/upsert.ts';
import type { OpenReads } from './refresh.ts';

export type GitHubDeps = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly client: OpenReads | null;
  readonly now: () => Date;
};

export async function followUpserts(
  deps: GitHubDeps,
  report: UpsertReport,
  logger: Logger,
): Promise<void> {
  const unknown = report.pullRequests.filter((pull) => !pull.filesKnown);
  if (unknown.length === 0) return;
  if (deps.client === null) {
    logger.warn('changed files not read: GitHub is not configured', {
      outcome: 'github_not_configured',
    });
    return;
  }
  const reads = deps.client();
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

import { z } from 'zod';
import type { IssueRef, JdArea } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import { ingestPrincipal } from '@uw/core/principal';
import type { Caller } from '@uw/harness';
import { boundedTitle, ensureIssuePage } from '../pages/issue-pages.ts';
import { randomIds } from '../ports/ids.ts';
import { ensureCrossReference } from './cross-reference.ts';
import type { GitHubDeps } from './deps.ts';
import type { IssueChange } from './facts/records.ts';
import { carriesHarnessLabel, HARNESS_LABEL } from './harness-label.ts';

const traceIdSchema = z.uuid();

function callerFor(logger: Logger): Caller {
  const trace = traceIdSchema.safeParse(logger.context.traceId);
  return { actor: ingestPrincipal(), traceId: trace.success ? trace.data : crypto.randomUUID() };
}

function issueOf(change: IssueChange): IssueRef {
  return { repo: change.repo, number: change.number, githubId: change.githubId };
}

async function wrapPage(deps: GitHubDeps, caller: Caller, change: IssueChange, jdArea: JdArea) {
  const issue = issueOf(change);
  return ensureIssuePage(
    deps.db,
    {
      jdArea,
      issue,
      title: change.title,
      url: `https://github.com/${issue.repo}/issues/${issue.number}`,
      editor: caller.actor.identity,
    },
    randomIds,
    caller.traceId,
  );
}

async function importLabelled(deps: GitHubDeps, change: IssueChange, logger: Logger) {
  const caller = callerFor(logger);
  const fields = { repository: change.repo, issue: change.number };
  const target = await deps.kernel.reads.importTarget(caller, { repository: change.repo });
  if (target.status !== 'accepted') {
    logger.info('labelled issue not imported: no harness names its repository', {
      outcome: 'no_harness_for_repository',
      ...fields,
    });
    return;
  }
  const page = await wrapPage(deps, caller, change, target.value.jdArea);
  if (!page.ok) {
    logger.warn('labelled issue not imported: its page slug is taken', {
      outcome: 'issue_page_slug_taken',
      ...fields,
    });
    return;
  }
  const imported = await deps.kernel.items.importIssue(caller, {
    harnessId: target.value.harnessId,
    issue: issueOf(change),
    title: boundedTitle(change.title, `${change.repo}#${change.number}`),
    pageId: page.pageId,
  });
  if (imported.status !== 'accepted') {
    logger.warn('labelled issue not imported', {
      outcome: 'issue_not_imported',
      ...fields,
      reason: imported.reason,
    });
    return;
  }
  const { item, created } = imported.value;
  logger.info('labelled issue imported', {
    outcome: created ? 'issue_imported' : 'issue_already_imported',
    ...fields,
  });
  await ensureCrossReference(
    deps,
    change,
    { itemId: item.itemId, pageCreatedAt: page.createdAt },
    logger,
  );
}

async function recordRemoval(deps: GitHubDeps, change: IssueChange, logger: Logger) {
  const caller = callerFor(logger);
  const imported = await deps.kernel.reads.issueImported(caller, { githubId: change.githubId });
  if (imported.status !== 'accepted' || !imported.value) return;
  const removed = await deps.kernel.items.labelRemoved(caller, {
    githubId: change.githubId,
    label: HARNESS_LABEL,
    githubUpdatedAt: change.githubUpdatedAt.toISOString(),
  });
  if (removed.status !== 'accepted') {
    logger.warn('harness label removal not recorded', {
      outcome: 'label_removal_refused',
      repository: change.repo,
      issue: change.number,
      reason: removed.reason,
    });
    return;
  }
  if (!removed.value.recorded) return;
  logger.info('harness label removal recorded', {
    outcome: 'label_removed',
    repository: change.repo,
    issue: change.number,
  });
}

export async function followIssue(
  deps: GitHubDeps,
  change: IssueChange,
  logger: Logger,
): Promise<void> {
  if (!carriesHarnessLabel(change.labels)) return recordRemoval(deps, change, logger);
  if (change.open) return importLabelled(deps, change, logger);
  logger.info('labelled issue not imported: it is closed', {
    outcome: 'issue_closed',
    repository: change.repo,
    issue: change.number,
  });
}

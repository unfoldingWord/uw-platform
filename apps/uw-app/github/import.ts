import { z } from 'zod';
import type { ErrorReason, IssueRef, JdArea } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import { ingestPrincipal } from '@uw/core/principal';
import type { Caller } from '@uw/harness';
import { boundedTitle, ensureIssuePage } from '../pages/issue-pages.ts';
import { randomIds } from '../ports/ids.ts';
import { ensureCrossReference, type CrossReference } from './cross-reference.ts';
import type { GitHubDeps } from './deps.ts';
import type { IssueChange } from './facts/records.ts';
import { carriesHarnessLabel, HARNESS_LABEL } from './harness-label.ts';

const traceIdSchema = z.uuid();

export function callerFor(logger: Logger): Caller {
  const trace = traceIdSchema.safeParse(logger.context.traceId);
  return { actor: ingestPrincipal(), traceId: trace.success ? trace.data : crypto.randomUUID() };
}

function issueOf(change: IssueChange): IssueRef {
  return { repo: change.repo, number: change.number, githubId: change.githubId };
}

export type ImportResult =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly reason: ErrorReason };

async function wrapPage(deps: GitHubDeps, caller: Caller, change: IssueChange, jdArea: JdArea) {
  const issue = issueOf(change);
  return ensureIssuePage(
    deps.db,
    {
      jdArea,
      issue,
      title: change.title,
      url: `https://github.com/${issue.repo}/issues/${issue.number}`,
      editor: ingestPrincipal().identity,
    },
    randomIds,
    caller.traceId,
  );
}

export function isImportable(change: IssueChange): boolean {
  return change.open && carriesHarnessLabel(change.labels);
}

type CrossReferenceTiming = 'now' | 'sweep';

function refusedTarget(caller: Caller): string {
  return caller.actor.kind === 'person' ? 'import_target_refused' : 'no_harness_for_repository';
}

async function crossReference(
  deps: GitHubDeps,
  change: IssueChange,
  reference: CrossReference,
  timing: CrossReferenceTiming,
  logger: Logger,
): Promise<void> {
  if (timing === 'now') return ensureCrossReference(deps, change, reference, logger);
  logger.info('cross-reference comment left for the nightly sweep', {
    outcome: 'cross_reference_deferred',
    repository: change.repo,
    issue: change.number,
  });
}

export async function importStoredIssue(
  deps: GitHubDeps,
  caller: Caller,
  change: IssueChange,
  logger: Logger,
  timing: CrossReferenceTiming,
): Promise<ImportResult> {
  const fields = { repository: change.repo, issue: change.number, importer: caller.actor.kind };
  const target = await deps.kernel.reads.importTarget(caller, { repository: change.repo });
  if (target.status !== 'accepted') {
    logger.info('issue not imported: no import target', {
      outcome: refusedTarget(caller),
      ...fields,
    });
    return { ok: false, reason: 'not_permitted' };
  }
  const page = await wrapPage(deps, caller, change, target.value.jdArea);
  if (!page.ok) {
    logger.warn('issue not imported: its page slug is taken', {
      outcome: 'issue_page_slug_taken',
      ...fields,
    });
    return { ok: false, reason: 'slug_taken' };
  }
  const imported = await deps.kernel.items.importIssue(caller, {
    harnessId: target.value.harnessId,
    issue: issueOf(change),
    title: boundedTitle(change.title, `${change.repo}#${change.number}`),
    pageId: page.pageId,
  });
  if (imported.status !== 'accepted') {
    const { reason } = imported;
    logger.warn('issue not imported', { outcome: 'issue_not_imported', ...fields, reason });
    return { ok: false, reason };
  }
  const { item, created } = imported.value;
  logger.info('issue imported', {
    outcome: created ? 'issue_imported' : 'issue_already_imported',
    ...fields,
  });
  const reference = { itemId: item.itemId, pageCreatedAt: page.createdAt };
  await crossReference(deps, change, reference, timing, logger);
  return { ok: true, created };
}

async function importLabelled(deps: GitHubDeps, change: IssueChange, logger: Logger) {
  await importStoredIssue(deps, callerFor(logger), change, logger, 'now');
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

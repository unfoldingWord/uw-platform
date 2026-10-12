import { z } from 'zod';
import type { Logger } from '@uw/core/log';
import type { GitHubClient, GitHubDeps } from './deps.ts';
import type { GitHubResult } from './failures.ts';
import {
  claimCrossReference,
  recordCrossReference,
  releaseCrossReference,
} from './facts/cross-reference.ts';
import type { IssueChange } from './facts/records.ts';

const MARKER = '<!-- uw-harness:cross-reference -->';
const sinceMarginMs = 60 * 60_000;
const posted = z.object({
  id: z.number().int().positive(),
  body: z.string().nullable().optional(),
  performed_via_github_app: z.object({ id: z.number() }).nullable().optional(),
});

export type CrossReference = {
  readonly itemId: string;
  readonly pageCreatedAt: Date;
};

export function crossReferenceBody(itemId: string): string {
  return `${MARKER}\nThis issue is tracked as harness item \`${itemId}\`.`;
}

function ourComment(comments: readonly unknown[], body: string, appId: string): number | null {
  for (const comment of comments) {
    const parsed = posted.safeParse(comment);
    if (!parsed.success) continue;
    const app = parsed.data.performed_via_github_app?.id;
    if (app === undefined || String(app) !== appId) continue;
    if (parsed.data.body?.trim() === body) return parsed.data.id;
  }
  return null;
}

async function placed(
  client: GitHubClient,
  change: IssueChange,
  reference: CrossReference,
): Promise<GitHubResult<{ readonly id: number; readonly found: boolean }>> {
  const body = crossReferenceBody(reference.itemId);
  const since = new Date(reference.pageCreatedAt.getTime() - sinceMarginMs);
  const listed = await client.reads().issueComments(change.repo, change.number, since);
  if (!listed.ok) return listed;
  const found = ourComment(listed.value, body, client.appId);
  if (found !== null) return { ok: true, value: { id: found, found: true } };
  const sent = await client.comments().comment(change.repo, change.number, body);
  return sent.ok ? { ok: true, value: { id: sent.value.id, found: false } } : sent;
}

export async function ensureCrossReference(
  deps: GitHubDeps,
  change: IssueChange,
  reference: CrossReference,
  logger: Logger,
): Promise<void> {
  const fields = { repository: change.repo, issue: change.number };
  if (deps.client === null) {
    logger.warn('cross-reference comment waits: GitHub is not configured', {
      outcome: 'github_not_configured',
      ...fields,
    });
    return;
  }
  const at = deps.now();
  if (!(await claimCrossReference(deps.db, change.githubId, at))) return;
  const result = await placed(deps.client, change, reference);
  if (!result.ok) {
    await releaseCrossReference(deps.db, change.githubId, at);
    logger.warn('cross-reference comment not posted', {
      outcome: 'cross_reference_not_posted',
      ...fields,
      failure: result.failure,
      status: result.status,
    });
    return;
  }
  await recordCrossReference(deps.db, change.githubId, result.value.id);
  logger.info('cross-reference comment recorded', {
    outcome: result.value.found ? 'cross_reference_found' : 'cross_reference_posted',
    ...fields,
    comment: result.value.id,
  });
}

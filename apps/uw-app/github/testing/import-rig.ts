import { ingestEnvelopeSchema, type IngestEnvelope } from '@uw/contracts';
import { createLogger, type Logger } from '@uw/core/log';
import { ingestPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { software, type KernelOutcome } from '@uw/harness';
import { systemClock } from '../../ports/clock.ts';
import { listForDispatch } from '../../testing/dispatch.ts';
import { kernelOn, personOn } from '../../testing/kernel.ts';
import type { GitHubAppConfig } from '../app-config.ts';
import { githubClient, type GitHubDeps } from '../deps.ts';
import { githubIngestHandler } from '../ingest.ts';
import { fixtureTransport } from './app-key.ts';
import type { FixtureGitHub, FixtureReply } from './fixture-github.ts';

export type Line = Record<string, unknown>;

export const platform = 'unfoldingWord/uw-platform';
const issueNumber = 12;
export const issueId = 9100000101;
export const commentId = 9100000701;
export const commentsPath = `/repos/${platform}/issues/${issueNumber}/comments`;
export const delivered = new Date('2026-10-02T09:00:00.000Z');
const ianId = '00000000-0000-4000-8000-000000000001';
export const harnessId = '00000000-0000-4000-8000-000000008701';

export function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

export async function seedSoftwareHarness(db: Database): Promise<void> {
  const ian = await personOn(db, ianId, 'ian.lindsley@unfoldingword.org', new Date());
  valueOf(
    await kernelOn(db, systemClock).stages.activate(
      { actor: ian, traceId: crypto.randomUUID() },
      {
        harnessId,
        harnessKey: 'software',
        jdArea: '80-89',
        template: software,
        repository: platform,
      },
    ),
  );
  await listForDispatch(db, platform);
}

export function withComments(
  github: FixtureGitHub,
  posts: FixtureReply | FixtureReply[] = { status: 201, body: { id: commentId } },
): FixtureGitHub {
  github.on('GET', commentsPath, { status: 200, body: [] });
  github.on('POST', commentsPath, posts);
  return github;
}

export function depsOn(
  db: Database,
  app: GitHubAppConfig,
  github: FixtureGitHub | null,
  now: Date = delivered,
): GitHubDeps {
  return {
    db,
    kernel: kernelOn(db, systemClock),
    client: github === null ? null : githubClient(app, fixtureTransport(github)),
    now: () => now,
  };
}

function envelope(event: string, payload: unknown): IngestEnvelope {
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 1,
    traceId: crypto.randomUUID(),
    source: 'github',
    deliveryId: crypto.randomUUID(),
    event,
    receivedAt: delivered.toISOString(),
    principal: ingestPrincipal(),
    payload,
    payloadTruncated: false,
  });
}

function recording(): { readonly logger: Logger; readonly lines: Line[] } {
  const lines: Line[] = [];
  const context = { traceId: crypto.randomUUID(), commit: 'c', route: 'queue ingest' };
  const logger = createLogger({ ...context, principal: ingestPrincipal().identity }, (line) =>
    lines.push(JSON.parse(line) as Line),
  );
  return { logger, lines };
}

export async function deliver(deps: GitHubDeps, payload: unknown): Promise<readonly Line[]> {
  const { logger, lines } = recording();
  await githubIngestHandler(deps)(envelope('issues', payload), logger);
  return lines;
}

export function posts(github: FixtureGitHub) {
  return github
    .requests()
    .filter((request) => request.method === 'POST' && request.path === commentsPath);
}

export async function imported(db: Database) {
  const pages = await db.$client`
    SELECT id, type, jd_area, status, frontmatter, body_md FROM pages WHERE type = 'issue'`;
  const items = await db.$client`
    SELECT i.id, i.page_id, s.key AS stage FROM harness_items i
    JOIN harness_stages s ON s.id = i.stage_id WHERE i.issue_github_id = ${issueId}`;
  const [issue] = await db.$client`
    SELECT xref_comment_id::text AS xref FROM gh_issues WHERE github_id = ${issueId}`;
  const xref: unknown = issue?.['xref'];
  return { pages, items, commentId: typeof xref === 'string' ? Number(xref) : null };
}

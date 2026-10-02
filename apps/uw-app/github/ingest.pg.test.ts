import { beforeAll, describe, expect, it } from 'vitest';
import { ingestEnvelopeSchema, type IngestEnvelope } from '@uw/contracts';
import { createLogger, type Logger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { ghPrs, ghRepos } from '@uw/db/schema';
import { systemClock } from '../ports/clock.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { pullRequestFacts } from './facts/queries.ts';
import checkRunCompleted from './fixtures/check-run-completed.json' with { type: 'json' };
import pullRequestOpened from './fixtures/pull-request-opened.json' with { type: 'json' };
import pullRequestReviewSubmitted from './fixtures/pull-request-review-submitted.json' with { type: 'json' };
import pullRequestSynchronize from './fixtures/pull-request-synchronize.json' with { type: 'json' };
import restFiles from './fixtures/rest-files.json' with { type: 'json' };
import type { GitHubDeps } from './follow-up.ts';
import { githubIngestHandler } from './ingest.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { base, changedPaths, head, nextHead } from './testing/facts-fixtures.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

type Line = Record<string, unknown>;

const ref = { repo: 'unfoldingWord/uw-platform', number: 7 };
const at = new Date('2026-10-02T09:00:00.000Z');
const compare = (to: string) => `/repos/unfoldingWord/uw-platform/compare/${base}...${to}`;
const nextPaths = ['apps/uw-app/other.ts'];
let app: GitHubAppConfig;
let deliveries = 0;

beforeAll(async () => {
  app = await fixtureApp();
});

function envelope(event: string, payload: unknown, truncated = false): IngestEnvelope {
  deliveries += 1;
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 1,
    traceId: crypto.randomUUID(),
    source: 'github',
    deliveryId: `delivery-${deliveries}`,
    event,
    receivedAt: '2026-10-02T08:59:00.000Z',
    principal: {
      identity: 'agent:ingest',
      kind: 'agent',
      personId: null,
      email: null,
      grants: [],
      interactive: false,
    },
    payload: truncated ? null : payload,
    payloadTruncated: truncated,
  });
}

function programmed(): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', compare(head), { status: 200, body: restFiles });
  github.on('GET', compare(nextHead), {
    status: 200,
    body: { status: 'ahead', files: nextPaths.map((filename) => ({ filename })) },
  });
  return github;
}

function depsOn(db: Database, github: FixtureGitHub | null): GitHubDeps {
  return {
    db,
    kernel: kernelOn(db, systemClock),
    client: github === null ? null : () => createGitHubReads(app, fixtureTransport(github)),
    now: () => at,
  };
}

function recording(): { readonly logger: Logger; readonly lines: Line[] } {
  const lines: Line[] = [];
  const context = { traceId: crypto.randomUUID(), commit: 'c', route: 'queue ingest' };
  const logger = createLogger({ ...context, principal: 'agent:ingest' }, (line) =>
    lines.push(JSON.parse(line)),
  );
  return { logger, lines };
}

async function deliver(deps: GitHubDeps, event: string, payload: unknown, truncated = false) {
  const { logger, lines } = recording();
  const outcome = await githubIngestHandler(deps)(envelope(event, payload, truncated), logger);
  return { outcome, lines };
}

function comparisons(github: FixtureGitHub): readonly string[] {
  return github
    .requests()
    .map((request) => request.path)
    .filter((path) => path.includes('/compare/'));
}

async function rowCounts(db: Database) {
  const repos = await db.select({ id: ghRepos.githubId }).from(ghRepos);
  const pulls = await db.select({ id: ghPrs.githubId }).from(ghPrs);
  const kernel = await db.$client`
    SELECT (SELECT count(*)::int FROM harnesses) AS harnesses,
           (SELECT count(*)::int FROM harness_items) AS items`;
  return { repos: repos.length, pulls: pulls.length, ...kernel[0] };
}

async function threeDeliveries(db: Database): Promise<void> {
  const deps = depsOn(db, programmed());
  await deliver(deps, 'pull_request', pullRequestOpened);
  await deliver(deps, 'pull_request_review', pullRequestReviewSubmitted);
  await deliver(deps, 'check_run', checkRunCompleted);
  const facts = await pullRequestFacts(db, ref);
  expect(facts).toMatchObject({ state: 'open', head, freshAt: at });
  expect(facts?.checks).toEqual([
    {
      checkId: 9100000401,
      name: 'test',
      headSha: head,
      app: 'github-actions',
      conclusion: 'success',
    },
  ]);
  expect(facts?.reviews).toEqual([
    expect.objectContaining({ reviewer: 'uw-reviewer[bot]', commit: head, state: 'approved' }),
  ]);
  expect(await rowCounts(db)).toEqual({ repos: 1, pulls: 1, harnesses: 0, items: 0 });
}

async function redelivered(db: Database): Promise<void> {
  const github = programmed();
  const deps = depsOn(db, github);
  await deliver(deps, 'pull_request', pullRequestOpened);
  const before = await pullRequestFacts(db, ref);
  const again = await deliver(deps, 'pull_request', pullRequestOpened);
  expect(await pullRequestFacts(db, ref)).toEqual(before);
  expect(again.lines).toContainEqual(
    expect.objectContaining({ outcome: 'upserted', repaired_pull_requests: 0, repaired_repos: 0 }),
  );
  expect(comparisons(github)).toEqual([compare(head)]);
}

async function filesFollowTheHead(db: Database): Promise<void> {
  const github = programmed();
  await deliver(depsOn(db, github), 'pull_request', pullRequestOpened);
  expect((await pullRequestFacts(db, ref))?.files).toEqual({ head, base, paths: changedPaths });
  const unconfigured = await deliver(depsOn(db, null), 'pull_request', pullRequestSynchronize);
  expect(unconfigured.outcome).toBe('handled');
  expect(unconfigured.lines).toContainEqual(
    expect.objectContaining({ level: 'warn', outcome: 'github_not_configured' }),
  );
  expect(await pullRequestFacts(db, ref)).toMatchObject({ head: nextHead, files: null });
  await deliver(depsOn(db, github), 'pull_request', pullRequestSynchronize);
  const refetched = await pullRequestFacts(db, ref);
  expect(refetched?.files).toEqual({ head: nextHead, base, paths: nextPaths });
  expect(comparisons(github)).toEqual([compare(head), compare(nextHead)]);
}

async function unconfiguredFromTheStart(db: Database): Promise<void> {
  const { outcome, lines } = await deliver(depsOn(db, null), 'pull_request', pullRequestOpened);
  expect(outcome).toBe('handled');
  expect(lines.map((line) => line['outcome'])).toEqual(['upserted', 'github_not_configured']);
  expect(await pullRequestFacts(db, ref)).toMatchObject({ head, files: null });
}

describe.skipIf(!testServer)(
  'GH-2 webhook deliveries feed the read model through the one upsert path',
  () => {
    it('answers open, the head, the check on the head and the approval on the head', () =>
      withAppDatabase(threeDeliveries));

    it('changes nothing when a delivery comes again', () => withAppDatabase(redelivered));

    it('records the files at the head, and a synchronize clears them until they are read again', () =>
      withAppDatabase(filesFollowTheHead));

    it('leaves the files unknown and says so when GitHub is not configured', () =>
      withAppDatabase(unconfiguredFromTheStart));
  },
);

async function unusable(db: Database): Promise<void> {
  const deps = depsOn(db, programmed());
  const truncated = await deliver(deps, 'pull_request', pullRequestOpened, true);
  const ping = await deliver(deps, 'ping', { zen: 'Keep it logically awesome.' });
  const malformed = await deliver(deps, 'issues', { action: 'opened', issue: {} });
  expect([truncated.outcome, ping.outcome, malformed.outcome]).toEqual([
    'handled',
    'handled',
    'malformed',
  ]);
  expect(truncated.lines).toContainEqual(
    expect.objectContaining({ outcome: 'payload_truncated', event: 'pull_request' }),
  );
  expect(ping.lines).toContainEqual(expect.objectContaining({ outcome: 'ignored', event: 'ping' }));
  expect(malformed.lines).toContainEqual(
    expect.objectContaining({ outcome: 'malformed_payload', event: 'issues' }),
  );
  expect(await rowCounts(db)).toEqual({ repos: 0, pulls: 0, harnesses: 0, items: 0 });
}

async function filesUnavailable(db: Database): Promise<void> {
  const github = fixtureGitHub();
  github.on('GET', compare(head), { status: 500, body: { message: 'boom' } });
  const { outcome, lines } = await deliver(depsOn(db, github), 'pull_request', pullRequestOpened);
  expect(outcome).toBe('handled');
  expect(lines).toContainEqual(
    expect.objectContaining({
      outcome: 'files_not_fetched',
      failure: 'server_error',
      status: 500,
      pull_request: 7,
    }),
  );
  expect(await pullRequestFacts(db, ref)).toMatchObject({ head, files: null });
}

async function databaseDown(): Promise<void> {
  const missing = new URL(testServer ?? '');
  missing.pathname = '/uw_no_such_database';
  const db = createClient(missing.toString());
  try {
    await expect(deliver(depsOn(db, null), 'pull_request', pullRequestOpened)).rejects.toThrow();
  } finally {
    await db.$client.end();
  }
}

describe.skipIf(!testServer)(
  'the GitHub handler acks what it cannot use and throws what failed',
  () => {
    it('writes nothing for a truncated, an ignored or a malformed delivery, and none throws', () =>
      withAppDatabase(unusable));

    it('logs a GitHub failure on the files and does not throw', () =>
      withAppDatabase(filesUnavailable));

    it('throws when the database fails, so the consumer retries', databaseDown);
  },
);

import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { GitHubAppConfig } from '../app-config.ts';
import { createGitHubReads } from '../client.ts';
import pullRequestOpened from '../fixtures/pull-request-opened.json' with { type: 'json' };
import pullRequestSynchronize from '../fixtures/pull-request-synchronize.json' with { type: 'json' };
import restFiles from '../fixtures/rest-files.json' with { type: 'json' };
import { fixtureApp, fixtureTransport } from '../testing/app-key.ts';
import { webhookBatch } from '../testing/batches.ts';
import { changedPaths, head, nextHead } from '../testing/facts-fixtures.ts';
import { fixtureGitHub, type FixtureGitHub } from '../testing/fixture-github.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { fetchFilesAtHead } from './files.ts';
import { pullRequestFacts } from './queries.ts';
import type { FactBatch } from './records.ts';
import { recordFiles, upsertFacts } from './upsert.ts';

const ref = { repo: 'unfoldingWord/uw-platform', number: 7 };
const tokenPath = '/app/installations/77/access_tokens';
const otherPaths = ['apps/uw-app/other.ts'];
const compare = (sha: string) => `/repos/unfoldingWord/uw-platform/compare/main...${sha}`;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 9, minute));

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function programmed(): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', compare(head), { status: 200, body: restFiles });
  github.on('GET', compare(nextHead), {
    status: 200,
    body: { status: 'ahead', commits: [], files: otherPaths.map((filename) => ({ filename })) },
  });
  return github;
}

function pushedBackTo(sha: string): FactBatch {
  const pull = { ...pullRequestSynchronize.pull_request, updated_at: '2026-10-02T08:50:00Z' };
  return webhookBatch('pull_request', {
    ...pullRequestSynchronize,
    pull_request: { ...pull, head: { ...pull.head, sha } },
  });
}

async function deliver(db: Database, github: FixtureGitHub, batch: FactBatch, minute: number) {
  const reads = createGitHubReads(app, fixtureTransport(github));
  const report = await upsertFacts(db, batch, at(minute));
  const [pull] = report.pullRequests;
  if (!pull) throw new TypeError('the delivery carried no pull request');
  const unknown = await pullRequestFacts(db, ref);
  return { unknown: unknown?.files, landed: await fetchFilesAtHead(reads, db, pull, at(minute)) };
}

const openedBatch = webhookBatch('pull_request', pullRequestOpened);
const movedBatch = webhookBatch('pull_request', pullRequestSynchronize);

function paths(github: FixtureGitHub, minted: boolean): readonly string[] {
  return github
    .requests()
    .map((request) => request.path)
    .filter((path) => (path === tokenPath) === minted);
}

async function filesNow(db: Database) {
  return (await pullRequestFacts(db, ref))?.files;
}

async function headThereAndBack(db: Database): Promise<void> {
  const github = programmed();
  const opened = await deliver(db, github, openedBatch, 0);
  expect(opened.landed).toEqual({ ok: true, value: true });
  expect(await filesNow(db)).toEqual({ head, paths: changedPaths });
  const moved = await deliver(db, github, movedBatch, 1);
  expect(moved.unknown).toBeNull();
  expect(await filesNow(db)).toEqual({ head: nextHead, paths: otherPaths });
  const back = await deliver(db, github, pushedBackTo(head), 2);
  expect(back.unknown).toBeNull();
  const late = { pullRequestId: 9100000201, head: nextHead, paths: otherPaths, problem: null };
  expect(await recordFiles(db, late, at(3))).toBe(false);
  expect(await filesNow(db)).toEqual({ head, paths: changedPaths });
  expect(paths(github, false)).toEqual([compare(head), compare(nextHead), compare(head)]);
}

async function oneMintPerDelivery(db: Database): Promise<void> {
  const github = programmed();
  await deliver(db, github, openedBatch, 0);
  await deliver(db, github, movedBatch, 1);
  expect(paths(github, true)).toHaveLength(2);
}

async function failedComparison(db: Database): Promise<void> {
  const github = fixtureGitHub();
  github.on('GET', compare(head), { status: 500, body: { message: 'boom' } });
  const opened = await deliver(db, github, openedBatch, 0);
  expect(opened.landed).toEqual({ ok: false, failure: 'server_error', status: 500 });
  expect(await filesNow(db)).toBeNull();
}

describe.skipIf(!testServer)(
  'GH-5 changed files are read by head SHA and kept against that head',
  () => {
    it('keeps the real files of a head after a push to another head and back', () =>
      withAppDatabase(headThereAndBack));

    it('mints one token for each delivery', () => withAppDatabase(oneMintPerDelivery));

    it('records nothing when GitHub fails to answer the comparison', () =>
      withAppDatabase(failedComparison));
  },
);

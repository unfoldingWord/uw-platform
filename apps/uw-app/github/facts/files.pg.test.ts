import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ghPrs } from '@uw/db/schema';
import type { GitHubAppConfig } from '../app-config.ts';
import { createGitHubReads } from '../client.ts';
import pullRequestOpened from '../fixtures/pull-request-opened.json' with { type: 'json' };
import pullRequestSynchronize from '../fixtures/pull-request-synchronize.json' with { type: 'json' };
import restFiles from '../fixtures/rest-files.json' with { type: 'json' };
import { fixtureApp, fixtureTransport } from '../testing/app-key.ts';
import { webhookBatch } from '../testing/batches.ts';
import { base, changedPaths, head, nextHead } from '../testing/facts-fixtures.ts';
import { fixtureGitHub, type FixtureGitHub } from '../testing/fixture-github.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { fetchFilesAtHead } from './files.ts';
import { pullRequestFacts } from './queries.ts';
import { recordFiles } from './heads.ts';
import { unknownHead, type FactBatch } from './records.ts';
import { upsertFacts } from './upsert.ts';

const ref = { repo: 'unfoldingWord/uw-platform', number: 7 };
const tokenPath = '/app/installations/77/access_tokens';
const otherPaths = ['apps/uw-app/other.ts'];
const migrationPaths = ['packages/db/migrations/0099_board.sql', 'apps/uw-app/board.tsx'];
const branchBase = 'a'.repeat(40);
const movedBase = '1'.repeat(40);
const compare = (from: string, to: string) =>
  `/repos/unfoldingWord/uw-platform/compare/${from}...${to}`;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 9, minute));

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function listing(files: readonly string[]) {
  return {
    status: 200,
    body: { status: 'ahead', commits: [], files: files.map((filename) => ({ filename })) },
  };
}

function programmed(): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', compare(base, head), { status: 200, body: restFiles });
  github.on('GET', compare(base, nextHead), listing(otherPaths));
  github.on('GET', compare(branchBase, head), listing(['apps/uw-app/board.tsx']));
  github.on('GET', compare(movedBase, head), listing(migrationPaths));
  return github;
}

type PullPayload = typeof pullRequestOpened.pull_request;

function delivered(updatedAt: string, change: (pull: PullPayload) => PullPayload): FactBatch {
  const pull = { ...pullRequestOpened.pull_request, updated_at: updatedAt };
  return webhookBatch('pull_request', { ...pullRequestOpened, pull_request: change(pull) });
}

function pushedBackTo(sha: string): FactBatch {
  return delivered('2026-10-02T08:50:00Z', (pull) => ({ ...pull, head: { ...pull.head, sha } }));
}

function basedOn(ref: string, sha: string, updatedAt: string): FactBatch {
  return delivered(updatedAt, (pull) => ({ ...pull, base: { ...pull.base, ref, sha } }));
}

async function deliver(db: Database, github: FixtureGitHub, batch: FactBatch, minute: number) {
  const reads = createGitHubReads(app, fixtureTransport(github));
  const report = await upsertFacts(db, batch, at(minute));
  const [pull] = report.pullRequests;
  if (!pull) throw new TypeError('the delivery carried no pull request');
  const unknown = await pullRequestFacts(db, ref);
  return { unknown: unknown?.files, landed: await fetchFilesAtHead(reads, db, pull) };
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
  expect(await filesNow(db)).toEqual({ head, base, paths: changedPaths });
  const moved = await deliver(db, github, movedBatch, 1);
  expect(moved.unknown).toBeNull();
  expect(await filesNow(db)).toEqual({ head: nextHead, base, paths: otherPaths });
  const back = await deliver(db, github, pushedBackTo(head), 2);
  expect(back.unknown).toBeNull();
  const late = {
    pullRequestId: 9100000201,
    head: nextHead,
    base,
    paths: otherPaths,
    problem: null,
    ...unknownHead,
  };
  expect(await recordFiles(db, late)).toBe(false);
  expect(await filesNow(db)).toEqual({ head, base, paths: changedPaths });
  expect(paths(github, false)).toEqual([
    compare(base, head),
    compare(base, nextHead),
    compare(base, head),
  ]);
}

async function retargeted(db: Database): Promise<void> {
  const github = programmed();
  const onBranch = basedOn('x', branchBase, '2026-10-02T08:00:00Z');
  await deliver(db, github, onBranch, 0);
  expect(await filesNow(db)).toEqual({ head, base: branchBase, paths: ['apps/uw-app/board.tsx'] });
  const toMain = basedOn('main', movedBase, '2026-10-02T08:10:00Z');
  await upsertFacts(db, toMain, at(1));
  const facts = await pullRequestFacts(db, ref);
  expect([facts?.head, facts?.base, facts?.files]).toEqual([head, movedBase, null]);
  const stored = await db.select({ files: ghPrs.files, base: ghPrs.filesBase }).from(ghPrs);
  expect(stored).toEqual([{ files: null, base: null }]);
  const late = {
    pullRequestId: 9100000201,
    head,
    base: branchBase,
    paths: [],
    problem: null,
    ...unknownHead,
  };
  expect(await recordFiles(db, late)).toBe(false);
  expect(await filesNow(db)).toBeNull();
  await deliver(db, github, toMain, 2);
  expect(await filesNow(db)).toEqual({ head, base: movedBase, paths: migrationPaths });
}

async function baseMovesForward(db: Database): Promise<void> {
  const github = programmed();
  await deliver(db, github, openedBatch, 0);
  const forward = await deliver(db, github, basedOn('main', movedBase, '2026-10-02T08:20:00Z'), 1);
  expect(forward.unknown).toBeNull();
  expect(await filesNow(db)).toEqual({ head, base: movedBase, paths: migrationPaths });
  expect(paths(github, false)).toEqual([compare(base, head), compare(movedBase, head)]);
  expect(paths(github, false).some((path) => path.includes('main'))).toBe(false);
}

async function oneMintPerDelivery(db: Database): Promise<void> {
  const github = programmed();
  await deliver(db, github, openedBatch, 0);
  await deliver(db, github, movedBatch, 1);
  expect(paths(github, true)).toHaveLength(2);
}

async function failedComparison(db: Database): Promise<void> {
  const github = fixtureGitHub();
  github.on('GET', compare(base, head), { status: 500, body: { message: 'boom' } });
  const opened = await deliver(db, github, openedBatch, 0);
  expect(opened.landed).toEqual({ ok: false, failure: 'server_error', status: 500 });
  expect(await filesNow(db)).toBeNull();
}

describe.skipIf(!testServer)(
  'GH-5 changed files are read and kept against one head and one base',
  () => {
    it('keeps the real files of a head after a push to another head and back', () =>
      withAppDatabase(headThereAndBack));

    it('never uses the files of the old base after the pull request is retargeted', () =>
      withAppDatabase(retargeted));

    it('reads the files again, by SHA, when the base moves forward', () =>
      withAppDatabase(baseMovesForward));

    it('records nothing when GitHub fails to answer the comparison', () =>
      withAppDatabase(failedComparison));
  },
);

describe.skipIf(!testServer)('a delivery that reads files mints one token', () => {
  it('mints one token for each delivery', () => withAppDatabase(oneMintPerDelivery));
});

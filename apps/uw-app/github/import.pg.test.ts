import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { crossReferenceBody } from './cross-reference.ts';
import issuesLabeled from './fixtures/issues-labeled.json' with { type: 'json' };
import issuesUnlabeled from './fixtures/issues-unlabeled.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';
import {
  commentId,
  commentsPath,
  delivered,
  deliver,
  depsOn,
  imported,
  platform,
  posts,
  issueId,
  seedSoftwareHarness,
  withComments,
} from './testing/import-rig.ts';
import { programmed, sweepOnce } from './testing/sweep-rig.ts';

const swept = new Date('2026-10-02T10:00:00.000Z');
const lapse = 10 * 60_000;
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

async function labelRemovals(db: Database): Promise<number> {
  const rows = await db.$client`
    SELECT e.id FROM harness_events e JOIN harness_items i ON i.id = e.item_id
    WHERE e.name = 'label_removed' AND i.issue_github_id = ${issueId}`;
  return rows.length;
}

async function setClaim(db: Database, claimedAt: Date | null): Promise<void> {
  await db.$client`
    UPDATE gh_issues SET xref_comment_id = NULL, xref_claimed_at = ${claimedAt?.toISOString() ?? null}::timestamptz
    WHERE github_id = ${issueId}`;
}

function sweeping(): FixtureGitHub {
  return withComments(programmed());
}

async function onlyOne(db: Database, github: FixtureGitHub): Promise<string> {
  const stored = await imported(db);
  expect(stored.pages).toHaveLength(1);
  expect(stored.items).toHaveLength(1);
  const [page] = stored.pages;
  const [item] = stored.items;
  expect(page).toMatchObject({
    type: 'issue',
    jd_area: '80-89',
    status: 'active',
    frontmatter: { url: `https://github.com/${platform}/issues/12`, github_id: 9100000101 },
  });
  expect(item).toMatchObject({ stage: 'package', page_id: page?.['id'] });
  const itemId = String(item?.['id']);
  expect(posts(github).map((request) => request.body)).toEqual([
    { body: crossReferenceBody(itemId) },
  ]);
  expect(stored.commentId).toBe(commentId);
  return itemId;
}

async function webhookFirst(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = sweeping();
  const deps = depsOn(db, app, github);
  await deliver(deps, issuesLabeled);
  await onlyOne(db, github);
  await Promise.all([deliver(deps, issuesLabeled), deliver(deps, issuesLabeled)]);
  await sweepOnce(db, app, { github, at: swept });
  await onlyOne(db, github);
}

async function sweepFirst(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = sweeping();
  await sweepOnce(db, app, { github, at: swept });
  await onlyOne(db, github);
  await deliver(depsOn(db, app, github), issuesLabeled);
  await onlyOne(db, github);
}

async function failedPost(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const outage = { status: 500, body: { message: 'Server Error' } };
  const github = withComments(programmed(), [outage, { status: 201, body: { id: commentId } }]);
  const lines = await deliver(depsOn(db, app, github), issuesLabeled);
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'cross_reference_not_posted' }));
  expect(await imported(db)).toMatchObject({ commentId: null });
  expect(posts(github)).toHaveLength(1);
  const soon = new Date(delivered.getTime() + 60_000);
  await sweepOnce(db, app, { github, at: soon });
  expect(posts(github)).toHaveLength(2);
  expect(await imported(db)).toMatchObject({ commentId });
  await sweepOnce(db, app, { github, at: new Date(swept.getTime() + lapse * 2) });
  expect(posts(github)).toHaveLength(2);
}

async function lostAfterPosting(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub());
  await deliver(depsOn(db, app, github), issuesLabeled);
  const itemId = await onlyOne(db, github);
  await setClaim(db, new Date(delivered.getTime() - lapse - 1));
  const ours = { id: commentId, body: crossReferenceBody(itemId), user: { type: 'Bot' } };
  const planted = { id: commentId - 1, body: crossReferenceBody(itemId), user: { type: 'User' } };
  github.on('GET', commentsPath, { status: 200, body: [planted, ours] });
  const lines = await deliver(depsOn(db, app, github), issuesLabeled);
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'cross_reference_found' }));
  await onlyOne(db, github);
}

async function lostBeforePosting(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub(), { status: 201, body: { id: commentId } });
  await deliver(depsOn(db, app, null), issuesLabeled);
  await setClaim(db, new Date(delivered.getTime() - 60_000));
  await deliver(depsOn(db, app, github), issuesLabeled);
  expect(posts(github)).toHaveLength(0);
  expect(await imported(db)).toMatchObject({ commentId: null });
  await deliver(depsOn(db, app, github, new Date(delivered.getTime() + lapse)), issuesLabeled);
  await onlyOne(db, github);
}

describe.skipIf(!testServer)(
  'GH-3 a labelled issue becomes one item with one cross-reference comment, whoever finds it first',
  () => {
    it('creates one issue page and one Package item from the webhook, and survives redelivery, concurrent delivery and the sweep', () =>
      withAppDatabase(webhookFirst));

    it('creates the same single page, item and comment when the sweep finds the issue first', () =>
      withAppDatabase(sweepFirst));

    it('releases the claim when the post answers 500, and the next sweep posts once', () =>
      withAppDatabase(failedPost));

    it('records the comment it already posted when the process was lost after posting, and posts nothing', () =>
      withAppDatabase(lostAfterPosting));

    it('posts nothing while a lost claim is fresh, and posts once after it lapses', () =>
      withAppDatabase(lostBeforePosting));
  },
);

async function unlabelled(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub());
  const deps = depsOn(db, app, github);
  await deliver(deps, issuesLabeled);
  const lines = await deliver(deps, issuesUnlabeled);
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'label_removed' }));
  expect(await labelRemovals(db)).toBe(1);
  expect((await imported(db)).items).toHaveLength(1);
  await deliver(deps, issuesUnlabeled);
  await sweepOnce(db, app, { github: withComments(programmed()), at: swept });
  expect(await labelRemovals(db)).toBe(1);
}

const elsewhere = {
  ...issuesLabeled,
  issue: { ...issuesLabeled.issue, id: 9100000109, number: 19 },
  repository: { ...issuesLabeled.repository, id: 9100000002, full_name: 'unfoldingWord/uw-other' },
};

async function unboundRepository(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = fixtureGitHub();
  const lines = await deliver(depsOn(db, app, github), elsewhere);
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'no_harness_for_repository' }));
  const counts = await db.$client`
    SELECT (SELECT count(*)::int FROM pages WHERE type = 'issue') AS pages,
           (SELECT count(*)::int FROM harness_items) AS items`;
  expect(counts[0]).toEqual({ pages: 0, items: 0 });
  expect(github.requests()).toEqual([]);
}

async function notConfigured(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const lines = await deliver(depsOn(db, app, null), issuesLabeled);
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'github_not_configured' }));
  expect(await imported(db)).toMatchObject({ commentId: null, items: [expect.anything()] });
  const github = sweeping();
  github.on('GET', `/repos/${platform}/issues`, { status: 200, body: [] });
  await sweepOnce(db, app, { github, at: swept });
  const calls = github.requests().filter((request) => request.path === commentsPath);
  expect(calls.map((request) => request.method)).toEqual(['GET', 'POST']);
  await onlyOne(db, github);
}

describe.skipIf(!testServer)('GH-3 removing the label records an event and keeps the item', () => {
  it('records label_removed once, however often the removal is seen', () =>
    withAppDatabase(unlabelled));
});

describe.skipIf(!testServer)('the import only reaches a repository a harness names', () => {
  it('creates nothing and calls GitHub for nothing for an unbound repository', () =>
    withAppDatabase(unboundRepository));

  it('creates the item without GitHub, and a later sweep posts the waiting comment', () =>
    withAppDatabase(notConfigured));
});

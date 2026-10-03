import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { upsertFacts } from '../github/facts/upsert.ts';
import { emptyBatch, type IssueRecord } from '../github/facts/records.ts';
import { webhookBatch } from '../github/testing/batches.ts';
import { crossReferenceBody } from '../github/cross-reference.ts';
import issuesLabeled from '../github/fixtures/issues-labeled.json' with { type: 'json' };
import type { GitHubAppConfig } from '../github/app-config.ts';
import { fixtureApp } from '../github/testing/app-key.ts';
import { labelledIssue, repo } from '../github/testing/facts-fixtures.ts';
import { commentId, deliver, depsOn, posts, withComments } from '../github/testing/import-rig.ts';
import { programmed, sweepOnce } from '../github/testing/sweep-rig.ts';
import { createLogger } from '@uw/core/log';
import { agentOf, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  dispatchAs,
  dispatchScope,
  eventsNamed,
  ian,
  post,
  softwareHarness,
  type Person,
  type Scene,
} from '../testing/commands.ts';

const platform = 'unfoldingWord/uw-platform';
const other = 'unfoldingWord/uw-other';
const otherRepo = { ...repo, githubId: 9100000002, fullName: other };
const swept = new Date('2026-10-03T10:00:00.000Z');

function issue(number: number, overrides: Partial<IssueRecord> = {}): IssueRecord {
  return { ...labelledIssue, githubId: 9100000100 + number, number, ...overrides };
}

const closedIssue = issue(13, { state: 'closed' });
const unlabelledIssue = issue(14, { labels: ['bug'] });
const otherIssue = issue(15, { repoId: otherRepo.githubId });

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

async function seedFacts(db: Database): Promise<void> {
  const labelled = webhookBatch('issues', issuesLabeled);
  await upsertFacts(db, labelled, new Date('2026-10-03T08:00:00.000Z'));
  await upsertFacts(
    db,
    {
      ...emptyBatch,
      repos: [repo, otherRepo],
      issues: [closedIssue, unlabelledIssue, otherIssue],
    },
    new Date('2026-10-03T08:00:00.000Z'),
  );
}

async function scene(db: Database): Promise<Scene> {
  const seeded = await softwareHarness(db);
  await seedFacts(db);
  return seeded;
}

type Opened = { count: number };

function send(
  db: Database,
  who: Pick<Person, 'email'>,
  harnessId: string,
  body: { readonly repository: string; readonly number: number },
) {
  const requestId = randomUUID();
  const path = `/api/harness/${harnessId}/commands/import`;
  return post(db, who.email, path, { command: 'import', requestId, ...body });
}

async function counts(db: Database) {
  const [row] = await db.$client`
    SELECT (SELECT count(*)::int FROM harness_items WHERE issue_github_id IS NOT NULL) AS items,
           (SELECT count(*)::int FROM pages WHERE type = 'issue') AS pages`;
  return { items: Number(row?.['items']), pages: Number(row?.['pages']) };
}

async function firstEditor(db: Database): Promise<unknown> {
  const [row] = await db.$client`
    SELECT v.edit_source FROM page_versions v JOIN pages p ON p.id = v.page_id
    WHERE p.type = 'issue' AND v.version = 1`;
  return row?.['edit_source'];
}

async function xrefOf(db: Database, githubId: number): Promise<unknown> {
  const [row] = await db.$client`
    SELECT xref_comment_id::text AS xref FROM gh_issues WHERE github_id = ${githubId}`;
  return row?.['xref'];
}

async function fromFacts(db: Database): Promise<void> {
  const { harnessId, editor } = await scene(db);
  const sent = await send(db, editor, harnessId, {
    repository: 'UNFOLDINGWORD/uw-platform',
    number: 12,
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
  const [created] = await eventsNamed(db, harnessId, 'item_created');
  expect(created).toMatchObject({
    actor: `human:${editor.id}`,
    requestId: sent.body['requestId'],
    evidence: { issue: { repo: platform, number: 12, githubId: labelledIssue.githubId } },
  });
  expect(await firstEditor(db)).toBe('agent:ingest');
  expect(await counts(db)).toEqual({ items: 1, pages: 1 });
}

async function twice(db: Database): Promise<void> {
  const { harnessId, editor, viewer } = await scene(db);
  const body = { repository: platform, number: 12 };
  expect((await send(db, editor, harnessId, body)).body).toMatchObject({ status: 'accepted' });
  expect((await send(db, editor, harnessId, body)).body).toMatchObject({ status: 'accepted' });
  expect(await counts(db)).toEqual({ items: 1, pages: 1 });
  expect(await eventsNamed(db, harnessId, 'item_created')).toHaveLength(1);
  const refused = await send(db, viewer, harnessId, body);
  expect(refused.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
}

async function unknownIssue(db: Database): Promise<void> {
  const { harnessId, editor } = await scene(db);
  const missing = await send(db, editor, harnessId, { repository: platform, number: 99 });
  expect(missing.body).toMatchObject({ status: 'error', reason: 'issue_not_found' });
  expect(await counts(db)).toEqual({ items: 0, pages: 0 });
}

async function notImportable(db: Database): Promise<void> {
  const { harnessId, editor } = await scene(db);
  for (const number of [closedIssue.number, unlabelledIssue.number]) {
    const sent = await send(db, editor, harnessId, { repository: platform, number });
    expect(sent.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  }
  expect(await counts(db)).toEqual({ items: 0, pages: 0 });
}

function withoutRequestId(sent: { readonly text: string; readonly body: Record<string, unknown> }) {
  return sent.text.replace(String(sent.body['requestId']), '');
}

async function foreignRepository(db: Database): Promise<void> {
  const { harnessId, editor } = await scene(db);
  const held = await send(db, editor, harnessId, { repository: other, number: otherIssue.number });
  const missing = await send(db, editor, harnessId, { repository: other, number: 99 });
  const nowhere = await send(db, editor, harnessId, {
    repository: 'unfoldingWord/nowhere',
    number: 12,
  });
  expect(held.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  for (const sent of [missing, nowhere]) {
    expect(withoutRequestId(sent)).toEqual(withoutRequestId(held));
  }
  expect(await counts(db)).toEqual({ items: 0, pages: 0 });
}

async function refusedPrincipals(db: Database): Promise<void> {
  const { harnessId, viewer } = await scene(db);
  const body = { repository: platform, number: 12 };
  const read = await send(db, viewer, harnessId, body);
  expect(read.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const agent = agentOf(await ian(db), 'builder');
  const requestId = randomUUID();
  const outcome = await dispatchAs(
    agent,
    harnessId,
    'import',
    { requestId, ...body },
    dispatchScope(db),
  );
  expect(outcome).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  expect(await counts(db)).toEqual({ items: 0, pages: 0 });
}

type Line = Record<string, unknown>;

async function importAs(db: Database, who: Person, harnessId: string, opened: Opened) {
  const lines: Line[] = [];
  const logger = createLogger(
    { traceId: randomUUID(), commit: 'test', route: 'POST', principal: null },
    (line) => lines.push(JSON.parse(line) as Line),
  );
  const gateGitHub = () => {
    opened.count += 1;
    return null;
  };
  const requestId = randomUUID();
  const actor = await personOn(db, who.id, who.email, new Date());
  const body = { requestId, repository: platform, number: 12 };
  const scope = dispatchScope(db, { logger, gateGitHub });
  const outcome = await dispatchAs(actor, harnessId, 'import', body, scope);
  expect(outcome).toEqual({ status: 'accepted', requestId });
  return lines.map((line) => line['outcome']);
}

async function noClient(db: Database): Promise<void> {
  const { harnessId, editor } = await scene(db);
  const opened = { count: 0 };
  const outcomes = await importAs(db, editor, harnessId, opened);
  expect(outcomes).toEqual(['issue_imported', 'cross_reference_deferred']);
  expect(opened.count).toBe(0);
  expect(await xrefOf(db, labelledIssue.githubId)).toBeNull();
  const github = withComments(programmed());
  await sweepOnce(db, app, { github, at: swept });
  const [created] = await eventsNamed(db, harnessId, 'item_created');
  expect(posts(github).map((request) => request.body)).toEqual([
    { body: crossReferenceBody(String(created?.itemId)) },
  ]);
  expect(await xrefOf(db, labelledIssue.githubId)).toBe(String(commentId));
  expect(await counts(db)).toEqual({ items: 1, pages: 1 });
}

async function webhookFirst(db: Database): Promise<void> {
  const { harnessId, editor } = await scene(db);
  await deliver(depsOn(db, app, null), issuesLabeled);
  const [created] = await eventsNamed(db, harnessId, 'item_created');
  expect(created?.actor).toBe('agent:ingest');
  const outcomes = await importAs(db, editor, harnessId, { count: 0 });
  expect(outcomes).toEqual(['issue_already_imported', 'cross_reference_deferred']);
  expect(await counts(db)).toEqual({ items: 1, pages: 1 });
  expect(await eventsNamed(db, harnessId, 'item_created')).toEqual([created]);
}

describe.skipIf(!testServer)('WB-1 GH-3 a person imports an issue by reference', () => {
  it("WB-1 import takes the issue's GitHub id from the read model and records item_created under the person", () =>
    withAppDatabase(fromFacts));

  it('WB-1 importing the same issue again creates nothing new', () => withAppDatabase(twice));

  it('WB-1 an issue the read model does not hold is issue_not_found', () =>
    withAppDatabase(unknownIssue));

  it('WB-1 a closed issue, or one without the harness label, is not_permitted', () =>
    withAppDatabase(notImportable));

  it('WB-1 an issue whose repository belongs to another harness is not_permitted, before any issue lookup', () =>
    withAppDatabase(foreignRepository));

  it('WB-1 an agent, and a person without write, cannot import', () =>
    withAppDatabase(refusedPrincipals));

  it('WB-1 GH-3 a person importing an issue the webhook imported first reuses its item and page', () =>
    withAppDatabase(webhookFirst));

  it('WB-1 GH-3 the import holds no GitHub client and leaves the cross-reference comment pending for the sweep', () =>
    withAppDatabase(noClient));
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  pageIndexReplySchema,
  pageListReplySchema,
  pageReadReplySchema,
  pageSearchReplySchema,
  pageVersionReplySchema,
  pageVersionsReplySchema,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, getRaw, person, post } from '../testing/commands.ts';
import { fileKnowledge, knowledgeBody } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

type World = {
  readonly editor: string;
  readonly viewer: string;
  readonly stranger: string;
  readonly parentId: string;
  readonly childId: string;
};

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'api-editor', 'editor', '00-09');
  const viewer = await person(db, 'api-viewer', 'viewer', '00-09');
  const stranger = await person(db, 'api-stranger', 'editor', '20-29');
  const parent = await fileKnowledge(db, editor.email, '01', {
    title: '01.12 Strategic Intents',
    bodyMd: '## Portfolios\n\nSix of them.',
    frontmatter: { jd_category: '01', jd_id: '01.12', aliases: ['Intents'] },
  });
  const child = await fileKnowledge(db, editor.email, '01', {
    title: 'Innovation',
    parentId: parent.pageId,
  });
  await fileKnowledge(db, editor.email, '02', { title: '02.16 Beginner cohort' });
  expect(child.sent.body).toMatchObject({ status: 'accepted' });
  return {
    editor: editor.email,
    viewer: viewer.email,
    stranger: stranger.email,
    parentId: parent.pageId,
    childId: child.pageId,
  };
}

const read = (db: Database, email: string, path: string) => get(db, { email }, path);

async function listsThePagesOfAnAreaA(db: Database): Promise<void> {
  const made = await world(db);
  const area = pageListReplySchema.parse(
    (await read(db, made.viewer, '/api/pages?area=00-09')).body,
  );
  expect(area.pages.map((page) => page.title)).toEqual([
    '01.12 Strategic Intents',
    '02.16 Beginner cohort',
    'Innovation',
  ]);
  expect(area.pages[0]).toMatchObject({ category: '01', jdId: '01.12', version: 1 });
  const category = await read(db, made.viewer, '/api/pages?category=02');
  expect(pageListReplySchema.parse(category.body).pages).toHaveLength(1);
  const top = await read(db, made.viewer, '/api/pages?area=00-09&parent=none');
  expect(pageListReplySchema.parse(top.body).pages).toHaveLength(2);
  const children = await read(db, made.viewer, `/api/pages?parent=${made.parentId}`);
  expect(pageListReplySchema.parse(children.body).pages.map((page) => page.id)).toEqual([
    made.childId,
  ]);
  const hidden = await read(db, made.stranger, '/api/pages?area=00-09');
  expect(pageListReplySchema.parse(hidden.body).pages).toEqual([]);
}

async function pagesThroughALongListWithA(db: Database): Promise<void> {
  const made = await world(db);
  const first = pageListReplySchema.parse(
    (await read(db, made.viewer, '/api/pages?area=00-09&limit=2')).body,
  );
  expect(first.pages).toHaveLength(2);
  expect(first.next).not.toBeNull();
  const rest = pageListReplySchema.parse(
    (await read(db, made.viewer, `/api/pages?area=00-09&limit=2&cursor=${first.next ?? ''}`)).body,
  );
  expect(rest.pages.map((page) => page.title)).toEqual(['Innovation']);
  expect(rest.next).toBeNull();
  const bad = await read(db, made.viewer, '/api/pages?limit=5000');
  expect(bad.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

async function saysWhatTheCallerMayDoAnd(db: Database): Promise<void> {
  const made = await world(db);
  const asEditor = pageReadReplySchema.parse(
    (await read(db, made.editor, `/api/pages/${made.parentId}`)).body,
  );
  expect(asEditor.capabilities).toEqual({ canEdit: true, canRetire: true, canComment: true });
  expect(asEditor.html).toBeUndefined();
  const asViewer = pageReadReplySchema.parse(
    (await read(db, made.viewer, `/api/pages/${made.parentId}?format=html`)).body,
  );
  expect(asViewer.capabilities).toEqual({ canEdit: false, canRetire: false, canComment: true });
  expect(asViewer.html).toContain('<h2 id="portfolios">Portfolios</h2>');
  expect(asViewer.headings).toEqual([{ depth: 2, id: 'portfolios', text: 'Portfolios' }]);
  const hidden = await read(db, made.stranger, `/api/pages/${made.parentId}`);
  expect(hidden.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
}

async function listsTheVersionsOfAPageAnd(db: Database): Promise<void> {
  const made = await world(db);
  const saved = await post(db, made.editor, '/api/pages/commands/update_page', {
    ...knowledgeBody('01', { title: '01.12 Strategic Intents', bodyMd: 'Second text.' }),
    command: 'update_page',
    pageId: made.parentId,
    expectedVersion: 1,
    frontmatter: { jd_category: '01', jd_id: '01.12' },
  });
  expect(saved.body).toMatchObject({ status: 'accepted', pageId: made.parentId, version: 2 });
  const list = pageVersionsReplySchema.parse(
    (await read(db, made.viewer, `/api/pages/${made.parentId}/versions`)).body,
  );
  expect(list.versions.map((entry) => entry.version)).toEqual([2, 1]);
  const first = pageVersionReplySchema.parse(
    (await read(db, made.viewer, `/api/pages/${made.parentId}/versions/1`)).body,
  );
  expect(first.page.bodyMd).toContain('Six of them.');
  const missing = await read(db, made.viewer, `/api/pages/${made.parentId}/versions/9`);
  expect(missing.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
  const hidden = await read(db, made.stranger, `/api/pages/${made.parentId}/versions`);
  expect(hidden.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
}

async function answersTheTitleIndexAsUnchangedUntil(db: Database): Promise<void> {
  const made = await world(db);
  const first = await getRaw(db, made.viewer, '/api/pages/index');
  const etag = first.headers.get('etag') ?? '';
  expect(etag).not.toBe('');
  const same = await getRaw(db, made.viewer, '/api/pages/index', { 'if-none-match': etag });
  expect(same.status).toBe(304);
  await fileKnowledge(db, made.editor, '01', { title: 'A new page' });
  const changed = await getRaw(db, made.viewer, '/api/pages/index', { 'if-none-match': etag });
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).not.toBe(etag);
}

async function givesTheTitlesAPersonMayRead(db: Database): Promise<void> {
  const made = await world(db);
  const first = await read(db, made.viewer, '/api/pages/index');
  const index = pageIndexReplySchema.parse(first.body);
  expect(index.entries.map((entry) => entry.title).sort()).toEqual([
    '01.12 Strategic Intents',
    '02.16 Beginner cohort',
    'Innovation',
  ]);
  expect(index.entries.find((entry) => entry.jdId === '01.12')?.aliases).toEqual(['Intents']);
  const other = pageIndexReplySchema.parse(
    (await read(db, made.stranger, '/api/pages/index')).body,
  );
  expect(other.entries).toEqual([]);
}

async function searchesTitleAndBodyAndReturnsWhere(db: Database): Promise<void> {
  const made = await world(db);
  const found = pageSearchReplySchema.parse(
    (await read(db, made.viewer, '/api/pages/search?q=portfolios')).body,
  );
  expect(found.results.map((result) => result.page.title)).toEqual(['01.12 Strategic Intents']);
  expect(found.results[0]?.snippet.some((part) => part.hit)).toBe(true);
  const none = await read(db, made.viewer, '/api/pages/search?q=');
  expect(none.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

async function answersARepeatedCreateOrSaveWith(db: Database): Promise<void> {
  const made = await world(db);
  const body = knowledgeBody('01', { title: 'Sent twice' });
  const first = await post(db, made.editor, '/api/pages/commands/create_page', body);
  const again = await post(db, made.editor, '/api/pages/commands/create_page', body);
  expect(first.body).toMatchObject({ status: 'accepted', pageId: body.pageId, version: 1 });
  expect(again.body).toEqual(first.body);
  const save = {
    ...body,
    command: 'update_page',
    requestId: randomUUID(),
    expectedVersion: 1,
    bodyMd: 'Edited once.',
  };
  const saved = await post(db, made.editor, '/api/pages/commands/update_page', save);
  const resent = await post(db, made.editor, '/api/pages/commands/update_page', save);
  expect(saved.body).toMatchObject({ status: 'accepted', version: 2 });
  expect(resent.body).toEqual(saved.body);
  const list = pageVersionsReplySchema.parse(
    (await read(db, made.editor, `/api/pages/${body.pageId}/versions`)).body,
  );
  expect(list.versions.map((entry) => entry.version)).toEqual([2, 1]);
  const stale = await post(db, made.editor, '/api/pages/commands/update_page', {
    ...save,
    requestId: randomUUID(),
  });
  expect(stale.body).toMatchObject({ status: 'error', reason: 'stale_version' });
}

describe.skipIf(!testServer)('#175 the page list, for any client', () => {
  it('lists the pages of an area, a category and a parent, and only where the person may read', () =>
    withAppDatabase(listsThePagesOfAnAreaA));

  it('pages through a long list with a cursor, never repeating or skipping a page', () =>
    withAppDatabase(pagesThroughALongListWithA));
});

describe.skipIf(!testServer)('#175 reading one page, for any client', () => {
  it('says what the caller may do, and renders the body on request', () =>
    withAppDatabase(saysWhatTheCallerMayDoAnd));

  it('lists the versions of a page and returns any one of them', () =>
    withAppDatabase(listsTheVersionsOfAPageAnd));
});

describe.skipIf(!testServer)('#175 the title index and search, for any client', () => {
  it('answers the title index as unchanged until a title changes', () =>
    withAppDatabase(answersTheTitleIndexAsUnchangedUntil));

  it('gives the titles a person may read, with JD IDs and aliases, and none from other areas', () =>
    withAppDatabase(givesTheTitlesAPersonMayRead));

  it('searches title and body and returns where the words were found', () =>
    withAppDatabase(searchesTitleAndBodyAndReturnsWhere));
});

describe.skipIf(!testServer)('#175 a page command can be sent twice', () => {
  it('answers a repeated create or save with the first result and writes nothing more', () =>
    withAppDatabase(answersARepeatedCreateOrSaveWith));
});

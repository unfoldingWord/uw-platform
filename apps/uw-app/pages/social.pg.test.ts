import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pageCommentsReplySchema, pageFavouriteReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, getRaw, person, post } from '../testing/commands.ts';
import { createApp } from '../app.tsx';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ORIGIN = { origin: 'http://localhost' };
const fixture = createAccessFixture();

type World = {
  readonly db: Database;
  readonly editor: string;
  readonly reader: string;
  readonly other: string;
  readonly stranger: string;
  readonly pageId: string;
};

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'social-editor', 'editor', '00-09');
  const reader = await person(db, 'social-reader', 'viewer', '00-09');
  const other = await person(db, 'social-other', 'viewer', '00-09');
  const stranger = await person(db, 'social-stranger', 'editor', '20-29');
  const filed = await fileKnowledge(db, editor.email, '01', { title: 'Expense limits' });
  return {
    db,
    editor: editor.email,
    reader: reader.email,
    other: other.email,
    stranger: stranger.email,
    pageId: filed.pageId,
  };
}

async function favour(made: World, email: string, method: 'PUT' | 'DELETE'): Promise<Response> {
  const keys = await fixture;
  const token = await keys.sign({ email });
  return createApp(postgresDeps(made.db, keys)).request(
    `/api/pages/${made.pageId}/favourite`,
    { method, headers: { 'cf-access-jwt-assertion': token, origin: 'http://localhost' } },
    fixtureAccessEnv,
  );
}

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function favouritesAreKeptPerPerson(db: Database): Promise<void> {
  const made = await world(db);
  const kept = await favour(made, made.reader, 'PUT');
  expect(pageFavouriteReplySchema.parse(await kept.json())).toMatchObject({ favourite: true });
  await favour(made, made.reader, 'PUT');
  const home = documentOf((await getHtml(db, made.reader, '/wiki')).text);
  const listed = [...home.querySelectorAll('[data-favourites] a')];
  expect(listed.map((link) => link.textContent)).toEqual(['Expense limits']);
  const others = documentOf((await getHtml(db, made.other, '/wiki')).text);
  expect(others.querySelector('[data-favourites]')).toBeNull();
  const view = documentOf((await getHtml(db, made.reader, `/pages/${made.pageId}`)).text);
  const toggle = view.querySelector(`main button[data-favourite="${made.pageId}"]`);
  expect(toggle?.getAttribute('aria-pressed')).toBe('true');
  const dropped = await favour(made, made.reader, 'DELETE');
  expect(pageFavouriteReplySchema.parse(await dropped.json())).toMatchObject({ favourite: false });
  expect((await favour(made, made.stranger, 'PUT')).status).toBe(404);
}

function comment(pageId: string, bodyMd: string) {
  return {
    command: 'comment_page',
    requestId: randomUUID(),
    commentId: randomUUID(),
    pageId,
    bodyMd,
  };
}

async function listed(made: World, email: string) {
  const sent = await get(made.db, { email }, `/api/pages/${made.pageId}/comments`);
  return pageCommentsReplySchema.parse(sent.body).comments;
}

async function aReaderCommentsAndAnEditorResolves(db: Database): Promise<void> {
  const made = await world(db);
  const said = comment(made.pageId, 'The limit changed in March.');
  const sent = await post(db, made.reader, '/api/pages/commands/comment_page', said);
  expect(sent.body).toMatchObject({ status: 'accepted' });
  await post(db, made.reader, '/api/pages/commands/comment_page', said);
  const comments = await listed(made, made.editor);
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({ id: said.commentId, resolvedAt: null });
  const blank = comment(made.pageId, '  ');
  expect((await post(db, made.reader, '/api/pages/commands/comment_page', blank)).status).toBe(400);
  const outside = comment(made.pageId, 'Let me in.');
  const refused = await post(db, made.stranger, '/api/pages/commands/comment_page', outside);
  expect(refused.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
  const hidden = await getRaw(db, made.stranger, `/api/pages/${made.pageId}/comments`);
  expect(hidden.status).toBe(404);
  const resolve = () => ({
    command: 'resolve_comment',
    requestId: randomUUID(),
    commentId: said.commentId,
  });
  const byOther = await post(db, made.other, '/api/pages/commands/resolve_comment', resolve());
  expect(byOther.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const byEditor = await post(db, made.editor, '/api/pages/commands/resolve_comment', resolve());
  expect(byEditor.body).toMatchObject({ status: 'accepted' });
  expect((await listed(made, made.reader))[0]?.resolvedAt).not.toBeNull();
}

async function aPassageIsQuoted(db: Database, made: World, path: string): Promise<void> {
  const quoted = new URLSearchParams({
    intent: 'add',
    requestId: randomUUID(),
    bodyMd: 'This changed.',
    quote: 'The limit is 50 dollars.',
  });
  await postForm(db, made.reader, path, quoted, ORIGIN);
  const asked = await getHtml(db, made.reader, `${path}?quote=Only%20these%20words`);
  const form = documentOf(asked.text).querySelector<HTMLTextAreaElement>('textarea[name="quote"]');
  expect(form?.textContent).toBe('Only these words');
  const withQuote = documentOf((await getHtml(db, made.reader, path)).text);
  expect(withQuote.querySelector('[data-quote]')?.textContent?.trim()).toBe(
    'The limit is 50 dollars.',
  );
}

async function theCommentsScreenShowsAndTakesComments(db: Database): Promise<void> {
  const made = await world(db);
  const path = `/pages/${made.pageId}/comments`;
  const said = new URLSearchParams({
    intent: 'add',
    requestId: randomUUID(),
    bodyMd: 'Is this **still** right? <script>steal()</script>',
  });
  const sent = await postForm(db, made.reader, path, said, ORIGIN);
  expect(sent.status).toBe(303);
  const screen = await getHtml(db, made.reader, path);
  expect(screen.status).toBe(200);
  expect(await screenProblems(screen.text)).toEqual([]);
  const document = documentOf(screen.text);
  expect(document.querySelector('[data-comment] strong')?.textContent).toBe('still');
  expect(screen.text).not.toContain('steal()');
  await aPassageIsQuoted(db, made, path);
  const view = await getHtml(db, made.reader, `/pages/${made.pageId}`);
  expect(documentOf(view.text).querySelector(`main a[href="${path}"]`)?.textContent).toBe(
    '2 open comments',
  );
  for (const comment of await listed(made, made.reader)) {
    const settle = new URLSearchParams({
      intent: 'resolve',
      requestId: randomUUID(),
      commentId: comment.id,
    });
    await postForm(db, made.reader, path, settle, ORIGIN);
  }
  const settled = await listed(made, made.reader);
  expect(settled.every((comment) => comment.resolvedAt !== null)).toBe(true);
  const after = await getHtml(db, made.reader, `/pages/${made.pageId}`);
  expect(documentOf(after.text).querySelector(`main a[href="${path}"]`)?.textContent).toBe(
    'Comments',
  );
  expect((await getHtml(db, made.stranger, path)).status).toBe(404);
}

describe.skipIf(!testServer)('#175 readers keep favourites and comment on pages', () => {
  it('keeps a favourite for the person who set it, and only on a page they can read', () =>
    withAppDatabase(favouritesAreKeptPerPerson));

  it('takes a comment from any reader once, and lets its author or an editor resolve it', () =>
    withAppDatabase(aReaderCommentsAndAnEditorResolves));

  it('shows comments as safe rendered text and takes them from the comments screen', () =>
    withAppDatabase(theCommentsScreenShowsAndTakesComments));
});

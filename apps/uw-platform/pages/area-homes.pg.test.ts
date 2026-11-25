import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { areaHomeReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, person, post } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';
import { JSDOM } from 'jsdom';

const SET = '/api/pages/commands/set_area_home';

type World = {
  readonly admin: string;
  readonly editor: string;
  readonly stranger: string;
  readonly homeId: string;
  readonly otherAreaId: string;
};

async function world(db: Database): Promise<World> {
  const admin = await person(db, 'home-admin', 'admin', '00-09');
  const editor = await person(db, 'home-editor', 'editor', '00-09');
  const stranger = await person(db, 'home-stranger', 'editor', '20-29');
  const home = await fileKnowledge(db, admin.email, '00', { title: '00.00 Start here' });
  await fileKnowledge(db, admin.email, '01', { title: '01.10 Expenses' });
  const elsewhere = await fileKnowledge(db, stranger.email, '21', { title: '21.01 Ledger' });
  return {
    admin: admin.email,
    editor: editor.email,
    stranger: stranger.email,
    homeId: home.pageId,
    otherAreaId: elsewhere.pageId,
  };
}

function setHome(area: string, pageId: string | null) {
  return { command: 'set_area_home', requestId: randomUUID(), area, pageId };
}

async function anAdminNamesTheHomePage(db: Database): Promise<void> {
  const made = await world(db);
  const sent = await post(db, made.admin, SET, setHome('00-09', made.homeId));
  expect(sent.body).toMatchObject({ status: 'accepted' });
  const read = await get(db, { email: made.editor }, '/api/pages/areas/00-09');
  const home = areaHomeReplySchema.parse(read.body);
  expect(home.home).toEqual({ id: made.homeId, title: '00.00 Start here' });
  expect(home.categories.map((entry) => entry.code)).toEqual(['00', '01']);
  await post(db, made.admin, SET, setHome('00-09', null));
  const cleared = await get(db, { email: made.editor }, '/api/pages/areas/00-09');
  expect(areaHomeReplySchema.parse(cleared.body).home).toBeNull();
}

async function onlyAnAreaAdminWithAPageFromThatArea(db: Database): Promise<void> {
  const made = await world(db);
  const byEditor = await post(db, made.editor, SET, setHome('00-09', made.homeId));
  expect(byEditor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const wrongArea = await post(db, made.admin, SET, setHome('00-09', made.otherAreaId));
  expect(wrongArea.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
  const hidden = await get(db, { email: made.stranger }, '/api/pages/areas/00-09');
  expect(hidden.status).toBe(404);
  expect((await get(db, { email: made.admin }, '/api/pages/areas/60-79')).status).toBe(404);
}

async function theAreaScreenShowsIt(db: Database): Promise<void> {
  const made = await world(db);
  const before = await getHtml(db, made.editor, '/wiki/areas/00-09');
  expect(before.status).toBe(200);
  expect(before.text).toContain('This area has no home page yet.');
  const manage = `/pages/${made.homeId}/manage`;
  const asEditor = await getHtml(db, made.editor, manage);
  expect(asEditor.text).not.toContain('Make it the home page');
  const asked = new URLSearchParams({ intent: 'home', requestId: randomUUID(), home: 'set' });
  const sent = await postForm(db, made.admin, manage, asked, { origin: 'http://localhost' });
  expect([sent.status, sent.headers.get('location')]).toEqual([303, '/wiki/areas/00-09']);
  const after = await getHtml(db, made.editor, '/wiki/areas/00-09');
  expect(await screenProblems(after.text)).toEqual([]);
  const document = new JSDOM(after.text).window.document;
  expect(document.querySelector('main [data-page-body]')).not.toBeNull();
  expect(document.querySelector('main h2')?.textContent).toContain('00.00 Start here');
  const listed = [...document.querySelectorAll('[data-area-categories] a')];
  expect(listed.map((link) => link.getAttribute('href'))).toEqual(['/wiki/00', '/wiki/01']);
  const wiki = new JSDOM((await getHtml(db, made.editor, '/wiki')).text).window.document;
  expect(wiki.querySelector('main a[href="/wiki/areas/00-09"]')?.textContent).toBe(
    '00-09 unfoldingWord Home',
  );
  expect((await getHtml(db, made.stranger, '/wiki/areas/00-09')).status).toBe(404);
}

describe.skipIf(!testServer)('#175 each area has a home page an area admin chooses', () => {
  it('lets an area admin choose it on the manage screen, and shows it on the area screen', () =>
    withAppDatabase(theAreaScreenShowsIt));

  it('names a page as the home of its area, shows it with the categories, and clears it', () =>
    withAppDatabase(anAdminNamesTheHomePage));

  it('takes the choice only from an admin of the area, and a page in that area', () =>
    withAppDatabase(onlyAnAreaAdminWithAPageFromThatArea));
});

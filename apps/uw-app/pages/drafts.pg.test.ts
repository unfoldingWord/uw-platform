import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { person } from '../testing/commands.ts';
import { memoryDrafts, type MemoryDrafts } from '../testing/drafts.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

type World = {
  readonly db: Database;
  readonly drafts: MemoryDrafts | null;
  readonly editor: string;
  readonly viewer: string;
  readonly pageId: string;
};

const fixture = createAccessFixture();
const SOCKET = { upgrade: 'websocket' };
const FORM = { origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' };

async function world(db: Database, drafts: MemoryDrafts | null): Promise<World> {
  const editor = await person(db, 'draft-editor', 'editor', '00-09');
  const viewer = await person(db, 'draft-viewer', 'viewer', '00-09');
  const page = await fileKnowledge(db, editor.email, '01', {
    title: 'Drafted together',
    bodyMd: 'As saved.',
  });
  return { db, drafts, editor: editor.email, viewer: viewer.email, pageId: page.pageId };
}

async function send(
  made: World,
  email: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const keys = await fixture;
  const token = await keys.sign({ email });
  const env =
    made.drafts === null
      ? fixtureAccessEnv
      : { ...fixtureAccessEnv, PAGE_DRAFT: made.drafts.namespace };
  return createApp(postgresDeps(made.db, keys)).request(
    path,
    {
      ...init,
      headers: { accept: 'text/html', ...init.headers, 'cf-access-jwt-assertion': token },
    },
    env,
  );
}

async function reasonOf(response: Response): Promise<unknown> {
  return ((await response.json()) as { reason?: unknown }).reason;
}

async function editorOf(made: World, path: string): Promise<Element | null> {
  const page = await send(made, made.editor, path);
  return new JSDOM(await page.text()).window.document.querySelector('[data-editor]');
}

async function socketNeedsAnEditorOnTheCurrentVersion(db: Database): Promise<void> {
  const made = await world(db, memoryDrafts());
  const path = `/api/pages/${made.pageId}/draft`;
  expect((await send(made, made.editor, `${path}?v=1&_pk=a1`)).status).toBe(426);
  const viewer = await send(made, made.viewer, `${path}?v=1&_pk=a1`, { headers: SOCKET });
  expect([viewer.status, await reasonOf(viewer)]).toEqual([403, 'not_permitted']);
  const stale = await send(made, made.editor, `${path}?v=2&_pk=a1`, { headers: SOCKET });
  expect([stale.status, await reasonOf(stale)]).toEqual([409, 'stale_version']);
  const malformed = await send(made, made.editor, `${path}?v=1`, { headers: SOCKET });
  expect(malformed.status).toBe(400);
  expect(made.drafts?.calls).toEqual([]);
  const joined = await send(made, made.editor, `${path}?v=1&_pk=a1`, { headers: SOCKET });
  expect(await joined.text()).toBe('joined');
  expect(made.drafts?.calls).toEqual([
    {
      room: `${made.pageId}.1`,
      method: 'GET',
      socket: true,
      url: 'https://draft.internal/room?_pk=a1',
    },
  ]);
}

async function socketIsNotWiredWithoutTheHub(db: Database): Promise<void> {
  const made = await world(db, null);
  const path = `/api/pages/${made.pageId}/draft?v=1&_pk=a1`;
  const refused = await send(made, made.editor, path, { headers: SOCKET });
  expect([refused.status, await reasonOf(refused)]).toEqual([404, 'not_wired']);
  expect(
    (await editorOf(made, `/pages/${made.pageId}/edit`))?.hasAttribute('data-draft-version'),
  ).toBe(false);
}

async function editScreenOffersTheRoom(db: Database): Promise<void> {
  const made = await world(db, memoryDrafts());
  const editor = await editorOf(made, `/pages/${made.pageId}/edit`);
  expect(editor?.getAttribute('data-draft-version')).toBe('1');
  expect(editor?.getAttribute('data-person')).toBe(made.editor);
  expect(editor?.querySelector('[data-editor-discard]')?.hasAttribute('hidden')).toBe(true);
  const asText = await editorOf(made, `/pages/${made.pageId}/edit?as=text`);
  expect(asText).toBeNull();
}

function form(version: number, bodyMd: string): string {
  return new URLSearchParams({
    requestId: crypto.randomUUID(),
    expectedVersion: String(version),
    title: 'Drafted together',
    bodyMd,
  }).toString();
}

async function savingClosesTheDraft(db: Database): Promise<void> {
  const made = await world(db, memoryDrafts());
  const path = `/pages/${made.pageId}/edit`;
  const saved = await send(made, made.editor, path, {
    method: 'POST',
    headers: FORM,
    body: form(1, 'Saved from the draft.'),
  });
  expect(saved.status).toBe(303);
  expect(made.drafts?.calls).toEqual([
    { room: `${made.pageId}.1`, method: 'POST', socket: false, url: 'https://draft.internal/room' },
  ]);
  const refused = await send(made, made.editor, path, {
    method: 'POST',
    headers: FORM,
    body: form(1, 'Typed on the old version.'),
  });
  expect(refused.status).toBe(200);
  expect(made.drafts?.calls).toHaveLength(1);
  const text = await refused.text();
  const shown = new JSDOM(text).window.document.querySelector('[data-editor]');
  expect(shown?.hasAttribute('data-draft-version')).toBe(false);
  expect(text).toContain('Typed on the old version.');
}

async function readViewSaysADraftIsOpen(db: Database): Promise<void> {
  const quiet = await world(db, memoryDrafts());
  const calm = await (await send(quiet, quiet.editor, `/pages/${quiet.pageId}`)).text();
  expect(calm).not.toContain('unsaved draft');
  const busy = { ...quiet, drafts: memoryDrafts([`${quiet.pageId}.1`]) };
  const noted = await (await send(busy, busy.editor, `/pages/${busy.pageId}`)).text();
  expect(noted).toContain(
    'There is an unsaved draft of this page. You are reading it as last saved.',
  );
  expect(noted).toContain('As saved.');
  const reader = await (await send(busy, busy.viewer, `/pages/${busy.pageId}`)).text();
  expect(reader).not.toContain('unsaved draft');
}

describe.skipIf(!testServer)('#175 people edit one shared draft of a page version', () => {
  it('opens the draft socket only for a person who may edit the current version', () =>
    withAppDatabase(socketNeedsAnEditorOnTheCurrentVersion));

  it('answers not_wired, and offers no room, where the hub is not bound', () =>
    withAppDatabase(socketIsNotWiredWithoutTheHub));

  it('offers the room of the version being edited on the edit screen', () =>
    withAppDatabase(editScreenOffersTheRoom));

  it('closes the draft when it is saved, and edits alone after a refused save', () =>
    withAppDatabase(savingClosesTheDraft));

  it('tells a person who may edit that an unsaved draft is open', () =>
    withAppDatabase(readViewSaysADraftIsOpen));
});

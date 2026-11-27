import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import type { Bindings } from '../env.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { person } from '../testing/commands.ts';
import { EDITOR, PAGE, openRig, viewer, type Rig } from '../testing/context-rig.ts';
import { memoryBucket } from '../testing/files.ts';
import { personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { levelled, seedStory } from '../testing/stories.ts';
import { storyUsesOf } from './uses.ts';

const AREA = '40-49';
const STORY_TEXT = 'read the first chapter aloud';
const fixture = createAccessFixture();

type World = {
  readonly db: Database;
  readonly email: string;
  readonly story: string;
  readonly host: string;
  readonly browser: ReturnType<typeof fakeBrowser>;
};

async function world(db: Database): Promise<World> {
  const made = await person(db, 'story-agent-owner', 'admin', AREA);
  const actor = await personOn(db, made.id, made.email, new Date());
  const { id: story } = await seedStory(db, AREA);
  await levelled(db, actor, story, 'newsletter');
  const host = randomUUID();
  await seedPage(db, {
    id: host,
    type: 'knowledge',
    status: 'active',
    jdArea: AREA,
    slug: `letter-${host.slice(0, 8)}`,
    title: 'Supporter letter',
    bodyMd: `Letter intro.\n\n![The well](/pages/${story})`,
    frontmatter: { jd_category: '41' },
  });
  return { db, email: made.email, story, host, browser: fakeBrowser() };
}

function envOf(made: World): Bindings {
  return {
    ...fixtureAccessEnv,
    FILES: memoryBucket(),
    BROWSER: made.browser,
    PDF_EXPORT: { create: async (options) => ({ id: options.id }) },
  };
}

async function call(made: World, name: string, args: Record<string, unknown>) {
  const keys = await fixture;
  const token = await keys.signForMcp({ email: made.email });
  const app = createApp(postgresDeps(made.db, keys));
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  const client = await httpClient(app, headers, envOf(made));
  try {
    const { body } = await callTool(client, name, args);
    return body;
  } finally {
    await client.close();
  }
}

async function readPageAskedForPublic(db: Database): Promise<void> {
  const made = await world(db);
  const refused = await call(made, 'read_page', { pageId: made.story, channel: 'public' });
  expect(refused).toMatchObject({ status: 'error', reason: 'story_above_channel' });
  expect(JSON.stringify(refused)).not.toContain(STORY_TEXT);
  const read = await call(made, 'read_page', { pageId: made.story, channel: 'newsletter' });
  expect(JSON.stringify(read)).toContain(STORY_TEXT);
  const inside = await call(made, 'read_page', { pageId: made.story });
  expect(JSON.stringify(inside)).toContain(STORY_TEXT);
  const uses = await storyUsesOf(db, made.story);
  expect(uses.map(({ channel, kind }) => ({ channel, kind }))).toEqual([
    { channel: 'newsletter', kind: 'agent_read' },
  ]);
}

async function searchAskedForPublic(db: Database): Promise<void> {
  const made = await world(db);
  const query = { query: 'well', type: null, limit: 10 };
  const open = await call(made, 'search_pages', { ...query, channel: 'public' });
  expect(JSON.stringify(open)).not.toContain(made.story);
  const inside = await call(made, 'search_pages', query);
  expect(JSON.stringify(inside)).toContain(made.story);
}

async function renderPdfAskedForPublic(db: Database): Promise<void> {
  const made = await world(db);
  const story = await call(made, 'render_pdf', {
    target: { kind: 'page', pageId: made.story },
    channel: 'public',
  });
  expect(story).toMatchObject({ status: 'error', reason: 'story_above_channel' });
  const host = await call(made, 'render_pdf', {
    target: { kind: 'page', pageId: made.host },
    channel: 'public',
  });
  expect(host).toMatchObject({ status: 'ready' });
  const html = made.browser
    .calls()
    .map((each) => each.html ?? '')
    .join('\n');
  expect(html).toContain('Letter intro.');
  expect(html).not.toContain(STORY_TEXT);
  const binder = await call(made, 'render_pdf', {
    target: { kind: 'binder', pageIds: [made.story] },
    channel: 'public',
  });
  expect(binder).toMatchObject({ status: 'error', reason: 'binder_empty' });
  expect(await storyUsesOf(db, made.story)).toEqual([]);
  const letter = await call(made, 'render_pdf', {
    target: { kind: 'page', pageId: made.host },
    channel: 'newsletter',
  });
  expect(letter).toMatchObject({ status: 'ready' });
  const [use] = await storyUsesOf(db, made.story);
  expect(use).toMatchObject({ channel: 'newsletter', kind: 'pdf_page' });
}

describe.skipIf(!testServer)(
  '#201 the MCP verbs refuse a newsletter story to the public channel',
  () => {
    it('#201 read_page asked for public refuses the story and a newsletter read records its use', () =>
      withAppDatabase(readPageAskedForPublic));
    it('#201 search_pages asked for public leaves the story out', () =>
      withAppDatabase(searchAskedForPublic));
    it('#201 render_pdf asked for public refuses the story, its embed and a binder of it alone', () =>
      withAppDatabase(renderPdfAskedForPublic));
  },
);

describe.skipIf(!testServer)('#201 resolve_context asked for public leaves the story out', () => {
  let rig: Rig | null = null;
  let story = '';
  beforeAll(async () => {
    const r = await openRig();
    rig = r;
    story = (await seedStory(r.db, '80-89', undefined, PAGE.item)).id;
    await levelled(r.db, r.rowan, story, 'newsletter');
  });
  afterAll(async () => {
    await rig?.drop();
  });

  it('#201 lists the story in the package at platform and leaves it out at public', async () => {
    const r = rig ?? never();
    const [itemId] = r.itemIds;
    const reader = await viewer(r, EDITOR);
    const inside = await reader('resolve_context', { itemId });
    expect(JSON.stringify(inside['package'])).toContain(story);
    const open = await reader('resolve_context', { itemId, channel: 'public' });
    expect(Array.isArray(open['package'])).toBe(true);
    expect(JSON.stringify(open['package'])).not.toContain(story);
  });
});

function never(): never {
  throw new Error('the rig is not open');
}

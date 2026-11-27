import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { memoryFiles } from '../pages/file-store.ts';
import { runPdfExport } from '../pdf/export-run.ts';
import { queueExport } from '../pdf/exports.ts';
import { binderPlan, printBinder, printPageIn } from '../pdf/print-targets.ts';
import { recordingPdf } from '../pdf/renderer.ts';
import { createApp } from '../app.tsx';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { getRaw, person } from '../testing/commands.ts';
import { memoryBucket } from '../testing/files.ts';
import { personOn } from '../testing/kernel.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { levelled, seedStory } from '../testing/stories.ts';
import { storyUsesOf } from './uses.ts';

const AREA = '40-49';
const COMMIT = 'test-commit';
const STORY_TEXT = 'read the first chapter aloud';

type World = {
  readonly db: Database;
  readonly email: string;
  readonly actor: Principal;
  readonly story: string;
  readonly host: string;
};

async function world(db: Database): Promise<World> {
  const made = await person(db, 'story-exporter', 'admin', AREA);
  const actor = await personOn(db, made.id, made.email, new Date());
  const { id: story } = await seedStory(db, AREA);
  await levelled(db, actor, story, 'newsletter');
  const host = randomUUID();
  await seedPage(db, {
    id: host,
    type: 'knowledge',
    status: 'active',
    jdArea: AREA,
    slug: `host-${host.slice(0, 8)}`,
    title: 'Quarterly letter',
    bodyMd: `Host intro.\n\n![The well](/pages/${story})\n\nHost outro.`,
    frontmatter: { jd_category: '41' },
  });
  return { db, email: made.email, actor, story, host };
}

async function markdown(made: World, pageId: string, channel: string) {
  const response = await getRaw(
    made.db,
    made.email,
    `/api/pages/${pageId}/export?channel=${channel}`,
  );
  return { status: response.status, text: await response.text() };
}

async function markdownRefusesAboveItsLevel(db: Database): Promise<void> {
  const made = await world(db);
  const refused = await markdown(made, made.story, 'public');
  expect(refused.status).toBe(403);
  expect(JSON.parse(refused.text)).toEqual({ status: 'error', reason: 'story_above_channel' });
  const allowed = await markdown(made, made.story, 'newsletter');
  expect(allowed.status).toBe(200);
  expect(allowed.text).toContain(STORY_TEXT);
  const uses = await storyUsesOf(db, made.story);
  expect(uses.map(({ channel, kind }) => ({ channel, kind }))).toEqual([
    { channel: 'newsletter', kind: 'markdown_export' },
  ]);
}

async function embedObeysTheHostChannel(db: Database): Promise<void> {
  const made = await world(db);
  const open = await markdown(made, made.host, 'public');
  expect(open.status).toBe(200);
  expect(open.text).toContain('Host intro.');
  expect(open.text).not.toContain(STORY_TEXT);
  expect(open.text).toContain('This section is not cleared for this channel.');
  expect(await storyUsesOf(db, made.story)).toEqual([]);
  const inside = await markdown(made, made.host, 'platform');
  expect(inside.text).toContain(STORY_TEXT);
  const [use] = await storyUsesOf(db, made.story);
  expect(use).toMatchObject({ channel: 'platform', kind: 'markdown_export', reference: made.host });
}

async function pdfRefusesAboveItsLevel(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  expect(
    await printPageIn(db, made.actor, { pageId: made.story, at, commit: COMMIT }, 'public'),
  ).toBe('story_above_channel');
  const host = await printPageIn(
    db,
    made.actor,
    { pageId: made.host, at, commit: COMMIT },
    'public',
  );
  if (host === null || typeof host === 'string') throw new Error('host not printed');
  expect(host.bodyHtml).toContain('Host intro.');
  expect(host.bodyHtml).not.toContain(STORY_TEXT);
  expect(host.stories).toEqual([]);
  const letter = await printPageIn(
    db,
    made.actor,
    { pageId: made.host, at, commit: COMMIT },
    'newsletter',
  );
  if (letter === null || typeof letter === 'string') throw new Error('letter not printed');
  expect(letter.bodyHtml).toContain(STORY_TEXT);
  expect(letter.stories).toEqual([made.story]);
}

async function binderLeavesTheStoryOut(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  const alone = {
    kind: 'binder' as const,
    title: 'Letters',
    pageIds: [made.story],
    channel: 'public' as const,
  };
  expect(await binderPlan(db, made.actor, alone, at)).toBe('binder_empty');
  const both = { ...alone, pageIds: [made.story, made.host] };
  const printed = await printBinder(db, made.actor, both, at, COMMIT);
  expect(printed?.bodyHtml).toContain('Host intro.');
  expect(printed?.bodyHtml).not.toContain(STORY_TEXT);
  const inside = await printBinder(db, made.actor, { ...both, channel: 'newsletter' }, at, COMMIT);
  expect(inside?.bodyHtml).toContain(STORY_TEXT);
}

async function queuedBinderKeepsItsChannel(db: Database): Promise<void> {
  const made = await world(db);
  const request = {
    kind: 'binder',
    title: 'Letters',
    pageIds: [made.story, made.host],
    channel: 'public',
  };
  const at = new Date();
  const input = { kind: 'binder' as const, title: 'Letters', reference: 'Letters', areas: [AREA] };
  const { exportId } = await queueExport(db, { ...input, request, actor: made.actor, at });
  const renderer = recordingPdf();
  const deps = {
    db,
    files: memoryFiles(),
    renderer,
    origin: 'https://app.example.test',
    commit: COMMIT,
    now: () => new Date(),
  };
  expect(await runPdfExport(deps, { exportId, traceId: 'trace' })).toBe('ready');
  const [job] = renderer.jobs();
  expect(job?.html).toContain('Host intro.');
  expect(job?.html).not.toContain(STORY_TEXT);
  expect(await storyUsesOf(db, made.story)).toEqual([]);
}

async function exportRouteRefusesTheStoryAlone(db: Database): Promise<void> {
  const made = await world(db);
  const keys = await createAccessFixture();
  const app = createApp(postgresDeps(db, keys));
  const env = {
    ...fixtureAccessEnv,
    FILES: memoryBucket(),
    BROWSER: fakeBrowser(),
    PDF_EXPORT: { create: async (options: { id: string }) => ({ id: options.id }) },
  };
  const body = { kind: 'binder', title: 'Letters', pageIds: [made.story], channel: 'public' };
  const headers = {
    'cf-access-jwt-assertion': await keys.sign({ email: made.email }),
    'content-type': 'application/json',
  };
  const sent = await app.request(
    '/api/exports',
    { method: 'POST', body: JSON.stringify(body), headers },
    env,
  );
  expect(await sent.json()).toEqual({ status: 'error', reason: 'binder_empty' });
}

describe.skipIf(!testServer)(
  '#201 a newsletter story is refused on every public export path',
  () => {
    it('#201 markdown export with channel public refuses the story and a newsletter export records its use', () =>
      withAppDatabase(markdownRefusesAboveItsLevel));
    it('#201 a story embedded in a public-channel markdown export is left out, and shown at platform', () =>
      withAppDatabase(embedObeysTheHostChannel));
    it('#201 a PDF of the story with channel public is refused and its embed is left out of the host', () =>
      withAppDatabase(pdfRefusesAboveItsLevel));
    it('#201 a public binder leaves the story out and refuses binder_empty when it is all there is', () =>
      withAppDatabase(binderLeavesTheStoryOut));
    it('#201 a queued public binder renders without the story in the export workflow', () =>
      withAppDatabase(queuedBinderKeepsItsChannel));
    it('#201 the export route refuses a public binder of the story alone', () =>
      withAppDatabase(exportRouteRefusesTheStoryAlone));
  },
);

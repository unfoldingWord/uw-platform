import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { storyApp, type StoryApp } from '../testing/story-app.ts';
import {
  consentFor,
  expressionAt,
  inventedStories,
  levelled,
  seedProgram,
  seedStory,
} from '../testing/stories.ts';
import { recordStoryConsent } from './levels.ts';

const AREA = '40-49';

type Scene = {
  readonly app: StoryApp;
  readonly editor: string;
  readonly admin: string;
  readonly stranger: string;
  readonly story: string;
  readonly program: string;
};

async function scene(db: Database): Promise<Scene> {
  const editor = await person(db, 'collating-editor', 'editor', AREA);
  const admin = await person(db, 'collating-admin', 'admin', AREA);
  const stranger = await person(db, 'collating-stranger', 'editor', '30-39');
  const program = await seedProgram(db, AREA);
  const record = inventedStories[0] ?? inventedStories[1];
  if (record === undefined) throw new Error('no invented story');
  const story = await seedStory(db, AREA, {
    ...record,
    frontmatter: { ...record.frontmatter, programs: [program] },
  });
  await seedStory(db, AREA, inventedStories[1]);
  return {
    app: storyApp(db),
    editor: editor.email,
    admin: admin.email,
    stranger: stranger.email,
    story: story.id,
    program,
  };
}

async function body(made: Scene, email: string, name: string, args: Record<string, unknown>) {
  return (await made.app.verb(email, name, args)).body;
}

function adding(storyId: string, index: number) {
  return { storyId, ...expressionAt(index) };
}

async function agentCollatesByVerbs(db: Database): Promise<void> {
  const made = await scene(db);
  const found = await body(made, made.editor, 'list_stories', { query: 'well' });
  expect(found['stories']).toEqual([
    expect.objectContaining({ id: made.story, expressionCount: 0 }),
  ]);
  const ids: string[] = [];
  for (const index of [0, 1, 2]) {
    const reply = await body(made, made.editor, 'add_story_expression', adding(made.story, index));
    expect(reply).toMatchObject({ created: true, status: 'suggested' });
    ids.push(String(reply['expressionId']));
  }
  const rerun = await body(made, made.editor, 'add_story_expression', adding(made.story, 1));
  expect(rerun).toMatchObject({ created: false, expressionId: ids[1] });
  const confirmed = await made.app.command(made.editor, 'confirm_story_expression', {
    expressionId: ids[1],
  });
  expect(confirmed.body).toMatchObject({ status: 'accepted' });
  const read = await body(made, made.editor, 'read_story', { storyId: made.story });
  const story = read['story'] as {
    expressions: {
      format: string;
      expressions: {
        status: string;
        addedBy: string;
        venue: string;
        channel: string;
        publishedOn: string | null;
      }[];
    }[];
  };
  expect(story.expressions.map((group) => group.format)).toEqual([
    'social_post',
    'newsletter_article',
    'annual_report',
  ]);
  const shown = story.expressions.flatMap((group) => group.expressions);
  expect(shown.map((each) => each.status)).toEqual(['suggested', 'suggested', 'confirmed']);
  expect(shown.every((each) => each.addedBy.startsWith('agent:'))).toBe(true);
  expect(shown.map(({ venue, channel, publishedOn }) => ({ venue, channel, publishedOn }))).toEqual(
    [
      { venue: 'Social media', channel: 'public', publishedOn: '2026-10-01' },
      { venue: 'Supporter newsletter', channel: 'newsletter', publishedOn: null },
      { venue: 'Annual report 2026', channel: 'newsletter', publishedOn: '2026-11-02' },
    ],
  );
}

const personOnly = [
  'confirm_story_expression',
  'retire_story_expression',
  'set_story_level',
  'set_story_media_level',
  'record_story_consent',
  'withdraw_story_consent',
];

async function agentHoldsNoDecidingVerb(db: Database): Promise<void> {
  const made = await scene(db);
  const tools = await made.app.tools(made.admin);
  const names = tools.map((tool) => tool.name);
  expect(names).toEqual(
    expect.arrayContaining(['write_page', 'add_story_expression', 'update_story_expression']),
  );
  expect(names.filter((name) => /confirm|level|consent|retire/.test(name))).toEqual([]);
  const fields = tools.flatMap((tool) => Object.keys(tool.inputSchema.properties ?? {}));
  expect(
    fields.filter((field) => /^(?:level|status|consent\w*|decidedBy|addedBy)$/.test(field)),
  ).toEqual([]);
  for (const name of personOnly) {
    await expect(
      made.app.verb(made.admin, name, { expressionId: randomUUID(), pageId: made.story }),
    ).rejects.toThrow(/Unknown tool/);
  }
  const raised = await body(made, made.admin, 'write_page', {
    pageId: made.story,
    type: 'impact_story',
    jdArea: AREA,
    slug: `raised-${made.story.slice(0, 8)}`,
    title: 'The well in Region One',
    parentId: null,
    frontmatter: { jd_category: '41', level: 'public', consent: 'recorded' },
    bodyMd: 'Notes.',
    expectedVersion: 1,
  });
  expect(raised).toMatchObject({ status: 'error', reason: 'invalid_frontmatter' });
  const added = await body(made, made.admin, 'add_story_expression', adding(made.story, 0));
  const confirming = {
    expressionId: added['expressionId'],
    ...expressionAt(0),
    status: 'confirmed',
  };
  const refused = await body(made, made.admin, 'update_story_expression', confirming);
  expect(refused).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

async function refusesPlainHttp(db: Database): Promise<void> {
  const made = await scene(db);
  const plain = {
    ...adding(made.story, 0),
    url: 'http://social.example.org/posts/region-one-well',
  };
  const refused = await body(made, made.editor, 'add_story_expression', plain);
  expect(refused).toMatchObject({ status: 'error', reason: 'url_not_https' });
}

async function strangerSeesNothing(db: Database): Promise<void> {
  const made = await scene(db);
  await body(made, made.editor, 'add_story_expression', adding(made.story, 0));
  const read = await body(made, made.stranger, 'read_story', { storyId: made.story });
  const missing = await body(made, made.stranger, 'read_story', { storyId: randomUUID() });
  expect(read).toMatchObject({ status: 'error', reason: 'page_not_found' });
  expect(JSON.stringify(read).replace(made.story, 'id')).toBe(
    JSON.stringify(missing).replace(/[0-9a-f-]{36}/, 'id'),
  );
  const listed = await body(made, made.stranger, 'list_stories', {});
  expect(listed).toEqual({ stories: [] });
  const added = await body(made, made.stranger, 'add_story_expression', adding(made.story, 1));
  expect(added).toMatchObject({ status: 'error', reason: 'page_not_found' });
}

async function listFindsByProgramAndTitle(db: Database): Promise<void> {
  const made = await scene(db);
  await body(made, made.editor, 'add_story_expression', adding(made.story, 0));
  const byProgram = await body(made, made.editor, 'list_stories', { program: made.program });
  expect(byProgram['stories']).toEqual([
    expect.objectContaining({ id: made.story, programs: [made.program], expressionCount: 1 }),
  ]);
  const byTitle = await body(made, made.editor, 'list_stories', { query: 'CHECKER' });
  expect((byTitle['stories'] as { title: string }[]).map((each) => each.title)).toEqual([
    'A checker in Region Two',
  ]);
  const told = await body(made, made.editor, 'list_stories', { formatPresent: 'social_post' });
  expect((told['stories'] as { id: string }[]).map((each) => each.id)).toEqual([made.story]);
  const untold = await body(made, made.editor, 'list_stories', { formatAbsent: 'social_post' });
  expect((untold['stories'] as { title: string }[]).map((each) => each.title)).toEqual([
    'A checker in Region Two',
  ]);
  const elsewhere = await body(made, made.editor, 'list_stories', { country: 'XC' });
  expect(elsewhere).toEqual({ stories: [] });
}

async function writePageTakesTheRecord(db: Database): Promise<void> {
  const made = await scene(db);
  const pageId = randomUUID();
  const page = (programs: readonly string[]) => ({
    pageId,
    type: 'impact_story',
    jdArea: AREA,
    slug: `story-${pageId.slice(0, 8)}`,
    title: 'Songs at the harvest',
    parentId: null,
    frontmatter: { jd_category: '41', occurred_on: '2026-09-20', place: 'Region Three', programs },
    bodyMd: 'Staff summary and research notes.',
    expectedVersion: null,
  });
  const unknown = await body(made, made.editor, 'write_page', page([randomUUID()]));
  expect(unknown).toMatchObject({ status: 'error', reason: 'program_not_found' });
  const notProgram = await body(made, made.editor, 'write_page', page([made.story]));
  expect(notProgram).toMatchObject({ status: 'error', reason: 'program_not_found' });
  const written = await body(made, made.editor, 'write_page', page([made.program]));
  expect(written).toMatchObject({ pageId, status: 'suggested' });
  const read = await body(made, made.editor, 'read_story', { storyId: pageId });
  expect(read['story']).toMatchObject({
    record: { occurred_on: '2026-09-20', place: 'Region Three', programs: [made.program] },
    programs: [{ id: made.program, title: 'Reading groups programme' }],
  });
}

async function placeKeptToItsPrecision(db: Database): Promise<void> {
  const made = await scene(db);
  const admin = await person(db, 'precision-admin', 'admin', AREA);
  const actor = await personOn(db, admin.id, admin.email, new Date());
  await levelled(db, actor, made.story, 'newsletter');
  await recordStoryConsent(
    db,
    actor,
    consentFor(made.story, { locationPrecision: 'country' }),
    new Date(),
  );
  const read = await body(made, admin.email, 'read_page', {
    pageId: made.story,
    channel: 'newsletter',
  });
  expect(read['page']).toMatchObject({ frontmatter: { country: 'XA', region: null, place: null } });
  const inside = await body(made, admin.email, 'read_page', { pageId: made.story });
  expect(inside['page']).toMatchObject({
    frontmatter: { region: 'XA-01', place: 'The well by the market in Region One' },
  });
}

describe.skipIf(!testServer)('ADR 0041 an agent researches and collates stories over MCP', () => {
  it('ADR 0041 an agent finds the story, adds three expressions that land suggested, reruns safely, and a person confirms one', () =>
    withAppDatabase(agentCollatesByVerbs));
  it('ADR 0041 an agent holds no verb that confirms an expression, sets a level or records consent', () =>
    withAppDatabase(agentHoldsNoDecidingVerb));
  it('ADR 0041 add_story_expression refuses a non-https address with url_not_https', () =>
    withAppDatabase(refusesPlainHttp));
  it("ADR 0041 a reader without a grant on the story's area sees no story or expression through read_story or list_stories", () =>
    withAppDatabase(strangerSeesNothing));
  it('ADR 0041 list_stories finds a story by program, by title words, by a format told or not, and by country', () =>
    withAppDatabase(listFindsByProgramAndTitle));
  it('ADR 0041 write_page takes the date, place and programs of a story record and refuses a program that is not a readable program page', () =>
    withAppDatabase(writePageTakesTheRecord));
  it('ADR 0041 read_page above the platform shows where a story happened only as precisely as its consent allows', () =>
    withAppDatabase(placeKeptToItsPrecision));
});

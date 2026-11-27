import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { person } from '../testing/commands.ts';
import { agentOf, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import {
  expressionAt,
  inventedStories,
  levelled,
  seedProgram,
  seedStory,
} from '../testing/stories.ts';
import { getHtml } from '../testing/views.ts';
import { addStoryExpression } from './expressions.ts';
import { recordStoryUses } from './uses.ts';

const AREA = '40-49';

async function scene(db: Database) {
  const admin = await person(db, 'telling-screen-admin', 'admin', AREA);
  const editor = await person(db, 'telling-screen-editor', 'editor', AREA);
  const stranger = await person(db, 'telling-screen-stranger', 'viewer', '30-39');
  const adminActor = await personOn(db, admin.id, admin.email, new Date());
  const editorActor = await personOn(db, editor.id, editor.email, new Date());
  const program = await seedProgram(db, AREA);
  const record = inventedStories[0];
  if (record === undefined) throw new Error('no invented story');
  const { id: story } = await seedStory(db, AREA, {
    ...record,
    frontmatter: { ...record.frontmatter, programs: [program] },
  });
  await levelled(db, adminActor, story, 'newsletter');
  const at = new Date();
  await addStoryExpression(db, editorActor, { pageId: story, ...expressionAt(1) }, at);
  await addStoryExpression(db, editorActor, { pageId: story, ...expressionAt(2) }, at);
  const agent = agentOf(editorActor, 'researcher');
  await addStoryExpression(db, agent, { pageId: story, ...expressionAt(0) }, at);
  const use = { channel: 'newsletter', kind: 'pdf_page', reference: 'export-eight' } as const;
  await recordStoryUses(db, {
    stories: [{ pageId: story, version: 1 }],
    usedBy: editorActor.identity,
    at,
    ...use,
  });
  return { editor, stranger, story };
}

async function shown(db: Database, email: string, path: string) {
  const html = await getHtml(db, email, path);
  expect(html.status, path).toBe(200);
  expect(await screenProblems(html.text), path).toEqual([]);
  return new JSDOM(html.text).window.document;
}

const shownWords = [
  'Social media',
  'Annual report 2026',
  'Supporter newsletter',
  '2026-11-02',
  'Not told yet',
  'Public',
  'Suggested',
  'Confirmed',
  'Told above its level',
];

function linksOut(section: Element | null): Element[] {
  return [...(section?.querySelectorAll('a[data-leaves-platform]') ?? [])];
}

function expectLinksOut(section: Element | null): void {
  const links = linksOut(section);
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    expressionAt(0).url,
    expressionAt(2).url,
    expressionAt(1).url,
  ]);
  expect(links.every((link) => link.getAttribute('rel') === 'noopener noreferrer')).toBe(true);
  const marked = links.filter((link) =>
    link.querySelector('[aria-label="Opens outside the platform"]'),
  );
  expect(marked).toHaveLength(links.length);
}

function expectRecord(text: string): void {
  for (const words of [
    '2026-03-14',
    'The well by the market in Region One',
    'Reading groups programme',
    'staff summary and research notes',
    'export-eight',
    'Annual report 2026',
  ]) {
    expect(text).toContain(words);
  }
}

async function storyPageListsExpressions(db: Database): Promise<void> {
  const made = await scene(db);
  const page = await shown(db, made.editor.email, `/pages/${made.story}`);
  const section = page.querySelector('[data-story-expressions]');
  const headings = [...(section?.querySelectorAll('h3') ?? [])].map((each) => each.textContent);
  expect(headings).toEqual(['Social posts', 'Newsletter articles', 'Annual reports']);
  const text = section?.textContent ?? '';
  for (const words of shownWords) expect(text).toContain(words);
  expectLinksOut(section);
  expect(section?.querySelectorAll('button[value="confirm_story_expression"]')).toHaveLength(1);
  expect(section?.querySelector('[data-command="add_story_expression"]')).not.toBeNull();
  expectRecord(page.querySelector('[data-story]')?.textContent ?? '');
}

async function storyBankShowsTellings(db: Database): Promise<void> {
  const made = await scene(db);
  const bank = await shown(db, made.editor.email, '/stories');
  const row = [...bank.querySelectorAll('tbody tr')].find((each) =>
    (each.textContent ?? '').includes('The well in Region One'),
  );
  const text = row?.textContent ?? '';
  expect(text).toContain('2026-03-14');
  expect(text).toContain('The well by the market in Region One');
  expect(text).toContain('Region');
  expect(text).toContain('Reading groups programme');
  expect(text).toContain('3');
  expect(text).toContain('2026-11-02');
  expect(text).toContain('1 told above its level');
}

async function strangerSeesNoTelling(db: Database): Promise<void> {
  const made = await scene(db);
  const page = await getHtml(db, made.stranger.email, `/pages/${made.story}`);
  expect(page.text).not.toContain('Annual report 2026');
  const bank = await shown(db, made.stranger.email, '/stories');
  expect(bank.querySelector('main')?.textContent ?? '').not.toContain('The well in Region One');
}

describe.skipIf(!testServer)('ADR 0041 the story screens show every telling', () => {
  it('ADR 0041 the story page lists every expression by format with its venue, channel, date, status and flags, linking out', () =>
    withAppDatabase(storyPageListsExpressions));
  it("ADR 0041 the Story Bank shows each story's date, place, programs, expression count, last told date and flags", () =>
    withAppDatabase(storyBankShowsTellings));
  it("ADR 0041 a reader without a grant on the story's area sees no expression on either screen", () =>
    withAppDatabase(strangerSeesNoTelling));
});

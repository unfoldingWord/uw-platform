import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { inventedStories, levelled, seedStory } from '../testing/stories.ts';
import { getHtml } from '../testing/views.ts';
import { recordStoryUses } from './uses.ts';

const AREA = '40-49';

async function scene(db: Database) {
  const admin = await person(db, 'bank-admin', 'admin', AREA);
  const editor = await person(db, 'bank-editor', 'editor', AREA);
  const stranger = await person(db, 'bank-stranger', 'viewer', '30-39');
  const actor = await personOn(db, admin.id, admin.email, new Date());
  const told = await seedStory(db, AREA, inventedStories[0]);
  const quiet = await seedStory(db, AREA, inventedStories[1]);
  await levelled(db, actor, told.id, 'newsletter');
  const use = { channel: 'newsletter', kind: 'pdf_page', reference: 'export-five' } as const;
  await recordStoryUses(db, {
    stories: [{ pageId: told.id, version: 1 }],
    usedBy: actor.identity,
    at: new Date(),
    ...use,
  });
  return { admin, editor, stranger, told: told.id, quiet: quiet.id };
}

async function shown(db: Database, email: string, path: string) {
  const html = await getHtml(db, email, path);
  expect(html.status, path).toBe(200);
  expect(await screenProblems(html.text), path).toEqual([]);
  return new JSDOM(html.text).window.document;
}

async function listsReadableStories(db: Database): Promise<void> {
  const made = await scene(db);
  const bank = await shown(db, made.editor.email, '/stories');
  const text = bank.querySelector('main')?.textContent ?? '';
  expect(text).toContain('The well in Region One');
  expect(text).toContain('A checker in Region Two');
  expect(text).toContain('Newsletter');
  expect(text).toContain('Recorded');
  expect(text).toContain('2027-11-01');
  const elsewhere = await shown(db, made.stranger.email, '/stories');
  expect(elsewhere.querySelector('main')?.textContent ?? '').not.toContain(
    'The well in Region One',
  );
}

function raiseButton(section: Element | null): Element | undefined {
  const buttons = [...(section?.querySelectorAll('button[value="set_story_level"]') ?? [])];
  return buttons.find((button) => button.textContent === 'Raise');
}

async function storyPageShowsLevelConsentAndUses(db: Database): Promise<void> {
  const made = await scene(db);
  const page = await shown(db, made.editor.email, `/pages/${made.told}`);
  const crumbs = [...page.querySelectorAll('nav[aria-label="Breadcrumb"] a')].map(
    (a) => a.textContent,
  );
  expect(crumbs[0]).toBe('Story Bank');
  const section = page.querySelector('[data-story]');
  const text = section?.textContent ?? '';
  expect(text).toContain('Newsletter');
  expect(text).toContain('Ada Example');
  expect(text).toContain('export-five');
  const raise = raiseButton(section);
  expect(raise?.getAttribute('aria-disabled')).toBe('true');
  expect(text).toContain('Not permitted');
  const adminPage = await shown(db, made.admin.email, `/pages/${made.told}`);
  const adminRaise = raiseButton(adminPage.querySelector('[data-story]'));
  expect(adminRaise?.getAttribute('aria-disabled')).toBeNull();
}

describe.skipIf(!testServer)('#201 the Story Bank screens', () => {
  it('#201 lists the stories a reader may read with their level, consent and review date', () =>
    withAppDatabase(listsReadableStories));
  it('#201 shows a story page with its level, consent, usage log and refusals in place', () =>
    withAppDatabase(storyPageShowsLevelConsentAndUses));
});

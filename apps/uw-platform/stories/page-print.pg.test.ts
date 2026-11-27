import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { fakeBrowser } from '../testing/browser.ts';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { inventedStories, levelled, seedStory } from '../testing/stories.ts';
import { getWithBindings } from '../testing/views.ts';
import { withdrawStoryConsent } from './levels.ts';
import { storyUsesOf } from './uses.ts';

const AREA = '40-49';
const STORY_TEXT = 'read the first chapter aloud';
const FREE_PLACE = inventedStories[0]?.frontmatter.place ?? 'no place';

async function staffPrintIsAUse(db: Database): Promise<void> {
  const made = await person(db, 'story-printer', 'admin', AREA);
  const admin = await personOn(db, made.id, made.email, new Date());
  const { id: story } = await seedStory(db, AREA);
  await levelled(db, admin, story, 'newsletter');
  const browser = fakeBrowser();
  const sent = await getWithBindings(db, made.email, `/pages/${story}?format=pdf`, {
    BROWSER: browser,
  });
  expect(sent.status).toBe(200);
  expect(sent.headers.get('content-type')).toBe('application/pdf');
  const html = browser.calls()[0]?.html ?? '';
  expect(html).toContain(STORY_TEXT);
  expect(html).not.toContain(FREE_PLACE);
  const uses = await storyUsesOf(db, story);
  expect(uses).toHaveLength(1);
  expect(uses[0]).toMatchObject({ pageId: story, channel: 'platform', kind: 'pdf_page' });
  const requestId = randomUUID();
  const command = { command: 'withdraw_story_consent', requestId, pageId: story } as const;
  const withdrawn = await withdrawStoryConsent(db, admin, { ...command }, new Date());
  if (!withdrawn.ok) throw new Error(`withdrawal refused: ${withdrawn.reason}`);
  expect(withdrawn.uses.map(({ kind, channel }) => ({ kind, channel }))).toEqual([
    { kind: 'pdf_page', channel: 'platform' },
  ]);
}

describe.skipIf(!testServer)('ADR 0041 the page Print as PDF obeys the Story Bank', () => {
  it('ADR 0041 a staff print of a story prints the story through the platform exporter and lands in the withdrawal report', () =>
    withAppDatabase(staffPrintIsAUse));
});

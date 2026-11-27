import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { ExpressionFields, Principal } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Database } from '@uw/db/client';
import { storyConsentHistory } from '@uw/db/schema';
import { printPageIn } from '../pdf/print-targets.ts';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { consentFor, expressionAt, levelled, seedStory } from '../testing/stories.ts';
import { addStoryExpression } from './expressions.ts';
import { recordStoryConsent, setStoryLevel, withdrawStoryConsent } from './levels.ts';
import { storyRecordFor } from './story-records.ts';

const AREA = '40-49';
const DAY_MS = 86_400_000;

type World = { readonly db: Database; readonly admin: Principal; readonly story: string };

async function world(db: Database): Promise<World> {
  const made = await person(db, 'release-keeper', 'admin', AREA);
  const admin = await personOn(db, made.id, made.email, new Date());
  const { id: story } = await seedStory(db, AREA);
  return { db, admin, story };
}

function dayFrom(at: Date, days: number): string {
  return formatDate(new Date(at.getTime() + days * DAY_MS));
}

function raise(made: World, level: 'newsletter' | 'public') {
  const requestId = randomUUID();
  const command = { command: 'set_story_level', requestId, pageId: made.story, level } as const;
  return setStoryLevel(made.db, made.admin, command, new Date());
}

async function consentAs(made: World, overrides: Parameters<typeof consentFor>[1]) {
  const outcome = await recordStoryConsent(
    made.db,
    made.admin,
    consentFor(made.story, overrides),
    new Date(),
  );
  expect(outcome).toEqual({ ok: true });
}

async function printedIn(made: World) {
  const asked = { pageId: made.story, at: new Date(), commit: 'test' };
  return printPageIn(made.db, made.admin, asked, 'newsletter');
}

async function futureReleaseRaisesNothing(db: Database): Promise<void> {
  const made = await world(db);
  const now = new Date();
  await consentAs(made, { consentedOn: dayFrom(now, 1) });
  expect(await raise(made, 'newsletter')).toEqual({ ok: false, reason: 'consent_not_started' });
  await consentAs(made, { consentedOn: '2026-01-01', consentExpires: formatDate(now) });
  expect(await raise(made, 'newsletter')).toEqual({ ok: false, reason: 'consent_expired' });
  await consentAs(made, { consentedOn: formatDate(now), consentExpires: dayFrom(now, 1) });
  expect(await raise(made, 'newsletter')).toEqual({ ok: true });
}

async function futureReleaseRendersNothing(db: Database): Promise<void> {
  const made = await world(db);
  const now = new Date();
  await levelled(db, made.admin, made.story, 'newsletter');
  expect(typeof (await printedIn(made))).toBe('object');
  await consentAs(made, { consentedOn: dayFrom(now, 1) });
  expect(await printedIn(made)).toBe('story_above_channel');
  await consentAs(made, { consentedOn: '2026-01-01', consentExpires: formatDate(now) });
  expect(await printedIn(made)).toBe('story_above_channel');
  await consentAs(made, { consentedOn: '2026-01-01', consentExpires: dayFrom(now, 1) });
  expect(typeof (await printedIn(made))).toBe('object');
}

function toldOn(publishedOn: string, at: number): ExpressionFields {
  return {
    ...expressionAt(1),
    channel: 'newsletter',
    url: `https://news.example.org/issues/${String(at)}/told-on-${publishedOn}`,
    publishedOn,
  };
}

async function toldOnEach(made: World, days: readonly string[]): Promise<void> {
  for (const [at, day] of days.entries()) {
    const fields = { pageId: made.story, ...toldOn(day, at) };
    const added = await addStoryExpression(made.db, made.admin, fields, new Date());
    expect(added.ok).toBe(true);
  }
}

async function unconsentedDays(made: World): Promise<readonly string[]> {
  const record = await storyRecordFor(made.db, made.admin, made.story, new Date());
  const told = record?.expressions.flatMap((group) => group.expressions) ?? [];
  return told
    .filter((expression) => expression.flags.includes('told_without_consent'))
    .flatMap((expression) => expression.publishedOn ?? [])
    .sort();
}

async function renewalKeepsTheOriginalInterval(db: Database): Promise<void> {
  const made = await world(db);
  await consentAs(made, { consentedOn: '2026-01-01', consentExpires: '2026-06-01' });
  await toldOnEach(made, ['2026-03-01', '2026-06-01', '2026-06-15', '2026-08-01']);
  expect(await unconsentedDays(made)).toEqual(['2026-06-01', '2026-06-15', '2026-08-01']);
  await consentAs(made, { consentedOn: '2026-07-01', consentExpires: null });
  expect(await unconsentedDays(made)).toEqual(['2026-06-01', '2026-06-15']);
  const withdrawn = await withdrawStoryConsent(
    db,
    made.admin,
    { command: 'withdraw_story_consent', requestId: randomUUID(), pageId: made.story },
    new Date(),
  );
  expect(withdrawn.ok).toBe(true);
  expect(await unconsentedDays(made)).toEqual(['2026-06-01', '2026-06-15']);
}

async function historyRefusesChange(db: Database): Promise<void> {
  const made = await world(db);
  await consentAs(made, { consentedOn: '2026-01-01', consentExpires: '2026-06-01' });
  const rows = await db
    .select({ kind: storyConsentHistory.kind, startsOn: storyConsentHistory.startsOn })
    .from(storyConsentHistory);
  expect(rows).toEqual([{ kind: 'granted', startsOn: '2026-01-01' }]);
  await expect(
    db.execute(sql`UPDATE story_consent_history SET starts_on = '2025-01-01'`),
  ).rejects.toThrow();
  await expect(db.execute(sql`DELETE FROM story_consent_history`)).rejects.toThrow();
}

describe.skipIf(!testServer)('ADR 0041 one effective interval for raising and rendering', () => {
  it('ADR 0041 a release that starts tomorrow, or expires today, raises no story', () =>
    withAppDatabase(futureReleaseRaisesNothing));
  it('ADR 0041 a release that starts tomorrow, or expires today, renders no story above the platform', () =>
    withAppDatabase(futureReleaseRendersNothing));
});

describe.skipIf(!testServer)('ADR 0041 consent history keeps every release interval', () => {
  it('ADR 0041 a telling inside the original release stays covered after a renewal; one in the gap does not', () =>
    withAppDatabase(renewalKeepsTheOriginalInterval));
  it('ADR 0041 the consent history is append-only', () => withAppDatabase(historyRefusesChange));
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExpressionFields, Principal } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Database } from '@uw/db/client';
import { person } from '../testing/commands.ts';
import { agentOf, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  consentFor,
  expressionAt,
  inventedStories,
  levelled,
  seedStory,
} from '../testing/stories.ts';
import {
  addStoryExpression,
  confirmStoryExpression,
  retireStoryExpression,
  updateStoryExpression,
} from './expressions.ts';
import { recordStoryConsent, withdrawStoryConsent } from './levels.ts';
import { storyRecordFor, storySummaries } from './story-records.ts';
import { recordStoryUses } from './uses.ts';

const AREA = '40-49';
const everything = {
  query: null,
  program: null,
  country: null,
  formatPresent: null,
  formatAbsent: null,
  limit: 50,
} as const;

type World = {
  readonly admin: Principal;
  readonly editor: Principal;
  readonly agent: Principal;
  readonly otherAgent: Principal;
  readonly stranger: Principal;
  readonly story: string;
};

async function principalOf(db: Database, made: { id: string; email: string }) {
  return personOn(db, made.id, made.email, new Date());
}

async function world(db: Database): Promise<World> {
  const admin = await principalOf(db, await person(db, 'telling-admin', 'admin', AREA));
  const editor = await principalOf(db, await person(db, 'telling-editor', 'editor', AREA));
  const stranger = await principalOf(db, await person(db, 'telling-stranger', 'viewer', '30-39'));
  const { id: story } = await seedStory(db, AREA);
  return {
    admin,
    editor,
    agent: agentOf(editor, 'researcher'),
    otherAgent: agentOf(admin, 'collator'),
    stranger,
    story,
  };
}

function onStory(pageId: string, fields: ExpressionFields) {
  return { pageId, ...fields };
}

async function added(db: Database, actor: Principal, pageId: string, fields: ExpressionFields) {
  const outcome = await addStoryExpression(db, actor, onStory(pageId, fields), new Date());
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome;
}

async function threeShownByFormat(db: Database): Promise<void> {
  const made = await world(db);
  for (const index of [0, 1, 2]) await added(db, made.editor, made.story, expressionAt(index));
  const record = await storyRecordFor(db, made.editor, made.story, new Date());
  const groups = record?.expressions.map((group) => group.format);
  expect(groups).toEqual(['social_post', 'newsletter_article', 'annual_report']);
  const shown = record?.expressions.flatMap((group) => group.expressions) ?? [];
  expect(shown.map(({ venue, channel, publishedOn }) => ({ venue, channel, publishedOn }))).toEqual(
    [
      { venue: 'Social media', channel: 'public', publishedOn: '2026-10-01' },
      { venue: 'Supporter newsletter', channel: 'newsletter', publishedOn: null },
      { venue: 'Annual report 2026', channel: 'newsletter', publishedOn: '2026-11-02' },
    ],
  );
  expect(shown.every((each) => each.status === 'confirmed')).toBe(true);
}

async function agentAddsAndPersonConfirms(db: Database): Promise<void> {
  const made = await world(db);
  const first = await added(db, made.agent, made.story, expressionAt(0));
  expect(first).toMatchObject({ created: true, status: 'suggested' });
  const rerun = { ...expressionAt(0), url: 'HTTPS://Social.Example.org/posts/region-one-well#top' };
  const again = await added(db, made.agent, made.story, rerun);
  expect(again).toMatchObject({ created: false, expressionId: first.expressionId });
  const at = new Date();
  const confirm = { expressionId: first.expressionId };
  expect(await confirmStoryExpression(db, made.agent, confirm, at)).toEqual({
    ok: false,
    reason: 'not_permitted',
  });
  expect(await confirmStoryExpression(db, made.editor, confirm, at)).toEqual({ ok: true });
  const record = await storyRecordFor(db, made.editor, made.story, at);
  const [shown] = record?.expressions[0]?.expressions ?? [];
  expect(shown).toMatchObject({
    status: 'confirmed',
    addedBy: made.agent.identity,
    decidedBy: made.editor.identity,
    url: 'https://social.example.org/posts/region-one-well',
  });
  expect(record?.expressions.flatMap((group) => group.expressions)).toHaveLength(1);
}

async function agentEditsOnlyItsOwnSuggestion(db: Database): Promise<void> {
  const made = await world(db);
  const mine = await added(db, made.agent, made.story, expressionAt(1));
  const edit = { expressionId: mine.expressionId, ...expressionAt(1), venue: 'Annual report' };
  const at = new Date();
  expect(await updateStoryExpression(db, made.otherAgent, edit, at)).toEqual({
    ok: false,
    reason: 'not_permitted',
  });
  expect(await updateStoryExpression(db, made.agent, edit, at)).toMatchObject({ ok: true });
  await confirmStoryExpression(db, made.editor, { expressionId: mine.expressionId }, at);
  expect(await updateStoryExpression(db, made.agent, edit, at)).toEqual({
    ok: false,
    reason: 'expression_decided',
  });
  const byPerson = { ...edit, venue: 'Annual report, page four' };
  expect(await updateStoryExpression(db, made.editor, byPerson, at)).toMatchObject({ ok: true });
  const other = await added(db, made.agent, made.story, expressionAt(0));
  const clash = { ...byPerson, expressionId: other.expressionId };
  expect(await updateStoryExpression(db, made.agent, clash, at)).toEqual({
    ok: false,
    reason: 'expression_exists',
  });
}

async function flaggedNeverRefused(db: Database): Promise<void> {
  const made = await world(db);
  await levelled(db, made.admin, made.story, 'newsletter');
  const afterConsent = { ...expressionAt(0), publishedOn: '2026-11-05' };
  const above = await added(db, made.agent, made.story, afterConsent);
  expect(above.flags).toEqual(['told_above_level']);
  const at = new Date();
  await withdrawStoryConsent(
    db,
    made.editor,
    { command: 'withdraw_story_consent', requestId: randomUUID(), pageId: made.story },
    at,
  );
  const afterWithdrawal = {
    ...expressionAt(2),
    channel: 'private_circulation',
    publishedOn: formatDate(at),
  } as const;
  const told = await added(db, made.agent, made.story, afterWithdrawal);
  expect(told.flags).toEqual(['told_above_level', 'told_without_consent']);
  const record = await storyRecordFor(db, made.editor, made.story, at);
  expect(record?.flags).toEqual({ toldAboveLevel: 2, toldWithoutConsent: 1 });
  expect(record?.consent.state).toBe('withdrawn');
}

async function withdrawalListsEveryTelling(db: Database): Promise<void> {
  const made = await world(db);
  await recordStoryConsent(db, made.editor, consentFor(made.story), new Date());
  for (const index of [0, 1, 2]) await added(db, made.agent, made.story, expressionAt(index));
  const use = { channel: 'newsletter', kind: 'pdf_page', reference: 'export-seven' } as const;
  await recordStoryUses(db, {
    stories: [{ pageId: made.story, version: 1 }],
    usedBy: made.editor.identity,
    at: new Date(),
    ...use,
  });
  const withdrawal = {
    command: 'withdraw_story_consent',
    requestId: randomUUID(),
    pageId: made.story,
  } as const;
  const report = await withdrawStoryConsent(db, made.editor, withdrawal, new Date());
  if (!report.ok) throw new Error(report.reason);
  expect(report.uses.map((each) => each.reference)).toEqual(['export-seven']);
  expect(
    report.expressions.map(({ title, venue, channel, url, publishedOn }) => ({
      title,
      venue,
      channel,
      url,
      publishedOn,
    })),
  ).toEqual(
    [0, 1, 2].map((index) => {
      const { title, venue, channel, url, publishedOn } = expressionAt(index);
      return { title, venue, channel, url, publishedOn };
    }),
  );
}

async function strangerSeesNoTelling(db: Database): Promise<void> {
  const made = await world(db);
  await added(db, made.editor, made.story, expressionAt(0));
  const at = new Date();
  expect(await storyRecordFor(db, made.stranger, made.story, at)).toBeNull();
  expect(await storySummaries(db, made.stranger, everything, at)).toEqual([]);
  const refused = await addStoryExpression(
    db,
    made.stranger,
    onStory(made.story, expressionAt(1)),
    at,
  );
  expect(refused).toEqual({ ok: false, reason: 'page_not_found' });
}

async function refusesByReason(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  const plain = { ...expressionAt(0), url: 'http://social.example.org/posts/region-one-well' };
  expect(await addStoryExpression(db, made.agent, onStory(made.story, plain), at)).toEqual({
    ok: false,
    reason: 'url_not_https',
  });
  const unknown = onStory(randomUUID(), expressionAt(0));
  expect(await addStoryExpression(db, made.agent, unknown, at)).toEqual({
    ok: false,
    reason: 'page_not_found',
  });
  const { id: retired } = await seedStory(db, AREA, inventedStories[2], null, 'retired');
  expect(await addStoryExpression(db, made.agent, onStory(retired, expressionAt(0)), at)).toEqual({
    ok: false,
    reason: 'story_retired',
  });
  const none = { expressionId: randomUUID() };
  expect(await retireStoryExpression(db, made.editor, none, at)).toEqual({
    ok: false,
    reason: 'expression_not_found',
  });
}

async function retiringKeepsTheRow(db: Database): Promise<void> {
  const made = await world(db);
  const told = await added(db, made.agent, made.story, expressionAt(0));
  const at = new Date();
  expect(
    await retireStoryExpression(db, made.editor, { expressionId: told.expressionId }, at),
  ).toEqual({ ok: true });
  expect(
    await retireStoryExpression(db, made.editor, { expressionId: told.expressionId }, at),
  ).toEqual({
    ok: false,
    reason: 'transition_not_allowed',
  });
  const [summary] = await storySummaries(db, made.editor, everything, at);
  expect(summary).toMatchObject({ expressionCount: 0, lastToldOn: null });
  const record = await storyRecordFor(db, made.editor, made.story, at);
  expect(record?.expressions[0]?.expressions[0]?.status).toBe('retired');
}

describe.skipIf(!testServer)('ADR 0041 a story record is told through its expressions', () => {
  it('ADR 0041 a story record with three expressions shows all three grouped by format, each with venue, channel and date', () =>
    withAppDatabase(threeShownByFormat));
  it("ADR 0041 an agent's expression lands suggested and added by the agent, the same address twice answers the same id, and only a person confirms it", () =>
    withAppDatabase(agentAddsAndPersonConfirms));
  it('ADR 0041 an agent edits only its own expression while it is suggested; a person edits any, and an address stays unique on its story', () =>
    withAppDatabase(agentEditsOnlyItsOwnSuggestion));
  it('ADR 0041 a telling above the level or after consent was withdrawn is stored and flagged, never refused', () =>
    withAppDatabase(flaggedNeverRefused));
  it('ADR 0041 withdrawing consent lists every expression and every recorded use', () =>
    withAppDatabase(withdrawalListsEveryTelling));
  it("ADR 0041 a reader without a grant on the story's area sees and adds no expression", () =>
    withAppDatabase(strangerSeesNoTelling));
  it('ADR 0041 refuses a non-https address, an unknown story, a retired story and an unknown expression by their reasons', () =>
    withAppDatabase(refusesByReason));
  it('ADR 0041 retiring an expression keeps the row and leaves it out of the counts', () =>
    withAppDatabase(retiringKeepsTheRow));
});

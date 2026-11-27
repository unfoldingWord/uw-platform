import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Principal, SensitivityLevel } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant } from '@uw/db/test-seed';
import { person, post } from '../testing/commands.ts';
import { agentOf, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { consentFor, seedStory } from '../testing/stories.ts';
import { recordStoryConsent, setStoryLevel, withdrawStoryConsent } from './levels.ts';
import { storyStateFor } from './reads.ts';
import { recordStoryUses } from './uses.ts';

const AREA = '40-49';

type World = {
  readonly admin: Principal;
  readonly editor: Principal;
  readonly orgViewer: Principal;
  readonly story: string;
};

async function principalOf(db: Database, made: { id: string; email: string }) {
  return personOn(db, made.id, made.email, new Date());
}

async function world(db: Database): Promise<World> {
  const admin = await person(db, 'story-admin', 'admin', AREA);
  const editor = await person(db, 'story-editor', 'editor', AREA);
  const viewer = await person(db, 'story-org-viewer', 'viewer', '00-09');
  await seedGrant(db, {
    id: randomUUID(),
    personId: viewer.id,
    role: 'viewer',
    scopeKind: 'org',
    scopeArea: null,
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  const { id } = await seedStory(db, AREA);
  return {
    admin: await principalOf(db, admin),
    editor: await principalOf(db, editor),
    orgViewer: await principalOf(db, viewer),
    story: id,
  };
}

function levelTo(pageId: string, level: SensitivityLevel) {
  return { command: 'set_story_level', requestId: randomUUID(), pageId, level } as const;
}

async function levelOf(db: Database, actor: Principal, pageId: string) {
  return (await storyStateFor(db, actor, pageId, new Date()))?.level;
}

async function cannotRaiseWithoutConsent(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  expect(await levelOf(db, made.admin, made.story)).toBe('internal');
  const raised = await setStoryLevel(db, made.admin, levelTo(made.story, 'newsletter'), at);
  expect(raised).toEqual({ ok: false, reason: 'consent_required' });
  expect(await levelOf(db, made.admin, made.story)).toBe('internal');
  const expired = consentFor(made.story, { consentExpires: '2026-01-01' });
  expect(await recordStoryConsent(db, made.editor, expired, at)).toEqual({ ok: true });
  const late = await setStoryLevel(db, made.admin, levelTo(made.story, 'public'), at);
  expect(late).toEqual({ ok: false, reason: 'consent_expired' });
  expect(await levelOf(db, made.admin, made.story)).toBe('internal');
}

async function raisingNeedsTheAreaAdmin(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  expect(await recordStoryConsent(db, made.editor, consentFor(made.story), at)).toEqual({
    ok: true,
  });
  const byEditor = await setStoryLevel(db, made.editor, levelTo(made.story, 'newsletter'), at);
  expect(byEditor).toEqual({ ok: false, reason: 'not_permitted' });
  const agent = agentOf(made.admin, 'storyteller');
  const byAgent = await setStoryLevel(db, agent, levelTo(made.story, 'newsletter'), at);
  expect(byAgent).toEqual({ ok: false, reason: 'not_permitted' });
  const byAdmin = await setStoryLevel(db, made.admin, levelTo(made.story, 'newsletter'), at);
  expect(byAdmin).toEqual({ ok: true });
  expect(await levelOf(db, made.editor, made.story)).toBe('newsletter');
  const lowered = await setStoryLevel(
    db,
    made.editor,
    levelTo(made.story, 'private_circulation'),
    at,
  );
  expect(lowered).toEqual({ ok: true });
  expect(await levelOf(db, made.editor, made.story)).toBe('private_circulation');
  const byViewer = await setStoryLevel(db, made.orgViewer, levelTo(made.story, 'internal'), at);
  expect(byViewer).toEqual({ ok: false, reason: 'not_permitted' });
}

async function withdrawalListsEveryUse(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  await recordStoryConsent(db, made.editor, consentFor(made.story), at);
  await setStoryLevel(db, made.admin, levelTo(made.story, 'public'), at);
  const usedBy = made.admin.identity;
  const uses = [
    { channel: 'public', kind: 'markdown_export', reference: 'export-one' },
    { channel: 'newsletter', kind: 'pdf_page', reference: 'export-two' },
    { channel: 'private_circulation', kind: 'pdf_binder', reference: 'export-three' },
  ] as const;
  for (const use of uses) {
    await recordStoryUses(db, {
      stories: [{ pageId: made.story, version: 1 }],
      usedBy,
      at,
      ...use,
    });
  }
  const withdrawal = {
    command: 'withdraw_story_consent',
    requestId: randomUUID(),
    pageId: made.story,
  } as const;
  const report = await withdrawStoryConsent(db, made.editor, withdrawal, at);
  if (!report.ok) throw new Error(report.reason);
  expect(report.uses.map((use) => use.reference).sort()).toEqual([
    'export-one',
    'export-three',
    'export-two',
  ]);
  expect(report.uses.every((use) => use.pageId === made.story && use.version === 1)).toBe(true);
  expect(await levelOf(db, made.admin, made.story)).toBe('internal');
  const again = await setStoryLevel(db, made.admin, levelTo(made.story, 'newsletter'), at);
  expect(again).toEqual({ ok: false, reason: 'consent_withdrawn' });
}

async function usesAreAppendOnly(db: Database): Promise<void> {
  const made = await world(db);
  const use = { channel: 'platform', kind: 'pdf_page', reference: 'export-four' } as const;
  await recordStoryUses(db, {
    stories: [{ pageId: made.story, version: 1 }],
    usedBy: made.admin.identity,
    at: new Date(),
    ...use,
  });
  await expect(db.execute(sql`UPDATE story_uses SET reference = 'changed'`)).rejects.toThrow();
  await expect(db.execute(sql`DELETE FROM story_uses`)).rejects.toThrow();
}

async function consentIsReadByItsRule(db: Database): Promise<void> {
  const made = await world(db);
  await recordStoryConsent(db, made.editor, consentFor(made.story), new Date());
  const forEditor = await storyStateFor(db, made.editor, made.story, new Date());
  expect(forEditor?.consent).toMatchObject({ kind: 'recorded', consentedBy: 'Ada Example' });
  const forOrgViewer = await storyStateFor(db, made.orgViewer, made.story, new Date());
  expect(forOrgViewer?.level).toBe('internal');
  expect(forOrgViewer?.consent).toEqual({ kind: 'withheld' });
}

async function commandsAnswerOverHttp(db: Database): Promise<void> {
  const admin = await person(db, 'story-route-admin', 'admin', AREA);
  const actor = await principalOf(db, admin);
  const { id } = await seedStory(db, AREA);
  const raise = { ...levelTo(id, 'newsletter') };
  const refused = await post(db, admin.email, '/api/stories/commands/set_story_level', raise);
  expect(refused.status).toBe(409);
  expect(refused.body).toEqual({
    status: 'error',
    requestId: raise.requestId,
    reason: 'consent_required',
  });
  const consent = await post(
    db,
    admin.email,
    '/api/stories/commands/record_story_consent',
    consentFor(id),
  );
  expect(consent.body).toMatchObject({ status: 'accepted' });
  const use = { channel: 'newsletter', kind: 'pdf_page', reference: 'export-six' } as const;
  await recordStoryUses(db, {
    stories: [{ pageId: id, version: 1 }],
    usedBy: actor.identity,
    at: new Date(),
    ...use,
  });
  const withdrawal = { command: 'withdraw_story_consent', requestId: randomUUID(), pageId: id };
  const report = await post(
    db,
    admin.email,
    '/api/stories/commands/withdraw_story_consent',
    withdrawal,
  );
  expect(report.status).toBe(200);
  expect(report.body).toMatchObject({ status: 'accepted', requestId: withdrawal.requestId });
  expect(report.body['uses']).toEqual([expect.objectContaining({ reference: 'export-six' })]);
}

describe.skipIf(!testServer)('#201 a story level moves only as its consent allows', () => {
  it('#201 the story commands answer over HTTP, the withdrawal with its report', () =>
    withAppDatabase(commandsAnswerOverHttp));
  it('#201 a story without recorded consent cannot be raised, and an expired one cannot raise it', () =>
    withAppDatabase(cannotRaiseWithoutConsent));
  it('#201 raising needs a person with admin on the area; lowering is open to any writer', () =>
    withAppDatabase(raisingNeedsTheAreaAdmin));
  it('#201 withdrawing consent drops the story to internal and lists every recorded use', () =>
    withAppDatabase(withdrawalListsEveryUse));
  it('#201 the usage log refuses an update and a delete', () => withAppDatabase(usesAreAppendOnly));
  it('#201 a consent record is read by its area readers and never through an org viewer grant', () =>
    withAppDatabase(consentIsReadByItsRule));
});

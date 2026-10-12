import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PageType } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  callerOf,
  command,
  eventCount,
  ian,
  softwareHarness,
  type Person,
} from '../testing/commands.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };

type Who = Pick<Person, 'email'>;

async function page(db: Database, jdArea: string, type: PageType = 'skill'): Promise<string> {
  const id = randomUUID();
  await seedPage(db, {
    id,
    type,
    status: 'active',
    jdArea,
    bodyMd: 'How the stage works.',
    slug: `stage-${id.slice(0, 8)}`,
    title: 'How the stage works',
  });
  return id;
}

async function areaAdmin(db: Database, area: string): Promise<Person> {
  const admin = { id: randomUUID(), email: `sp-${area}@unfoldingword.org`, grantId: randomUUID() };
  await seedPerson(db, { id: admin.id, email: admin.email });
  await seedGrant(db, {
    id: admin.grantId,
    personId: admin.id,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  return admin;
}

function spare(instructionsPageId: string | null) {
  return {
    key: `spare_${randomUUID().slice(0, 8)}`,
    title: 'Spare',
    position: 90,
    bracket: 'iterate',
    agentPickup: 'allowed',
    exitGate: 'checks',
    connector: 'none',
    wipLimit: 3,
    instructionsPageId,
    validators: [],
    feeds: [],
  };
}

async function namingStages(db: Database, pageId: string): Promise<number> {
  const rows = await db.$client`
    SELECT count(*)::int AS n FROM harness_stages WHERE instructions_page_id = ${pageId}`;
  return Number(rows[0]?.n);
}

type Answer = { readonly status: number; readonly text: string };

async function answers(db: Database, who: Who, harnessId: string, pageId: string) {
  const replies: Answer[] = [];
  for (const [name, body] of [
    ['create_stage', { stage: spare(pageId) }],
    ['update_stage', { stageKey: 'build', change: { instructionsPageId: pageId } }],
  ] as const) {
    const requestId = randomUUID();
    const sent = await command(db, who, harnessId, name, { requestId, ...body });
    expect(sent.body).toEqual({ status: 'error', requestId, reason: 'page_not_found' });
    replies.push({ status: sent.status, text: sent.text.replace(requestId, '') });
  }
  return replies;
}

async function everyUnusablePageAnswersAlike(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const admin = await areaAdmin(db, '80-89');
  const before = await eventCount(db, scene.harnessId);
  const targets = [
    randomUUID(),
    await page(db, '20-29'),
    await page(db, '30-39'),
    await page(db, '80-89', 'issue'),
  ];
  const seen = new Set<string>();
  for (const pageId of targets) {
    for (const reply of await answers(db, admin, scene.harnessId, pageId)) {
      seen.add(`${reply.status} ${reply.text}`);
    }
  }
  expect(seen.size).toBe(1);
  expect(await eventCount(db, scene.harnessId)).toBe(before);
  for (const pageId of targets) expect(await namingStages(db, pageId)).toBe(0);
}

async function noAdminFreezesAnotherArea(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const elsewhere = await page(db, '20-29');
  const readable = await page(db, '30-39');
  for (const pageId of [elsewhere, readable]) {
    for (const reply of await answers(db, IAN, scene.harnessId, pageId)) {
      expect(reply.status).toBe(404);
    }
    expect(await namingStages(db, pageId)).toBe(0);
  }
}

async function samePageIsNamed(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const admin = await areaAdmin(db, '80-89');
  const inside = await page(db, '80-89');
  const requestId = randomUUID();
  const sent = await command(db, admin, scene.harnessId, 'update_stage', {
    requestId,
    stageKey: 'build',
    change: { instructionsPageId: inside },
  });
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect(await namingStages(db, inside)).toBe(1);
}

async function kernelRefusesBeforeTheKey(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const kernel = kernelOn(db, { now: () => new Date() });
  const caller = callerOf(await ian(db));
  const before = await eventCount(db, scene.harnessId);
  for (const pageId of [randomUUID(), await page(db, '20-29'), await page(db, '80-89', 'issue')]) {
    const created = await kernel.stages.createStage(caller, {
      harnessId: scene.harnessId,
      stage: spare(pageId) as Parameters<typeof kernel.stages.createStage>[1]['stage'],
    });
    const updated = await kernel.stages.updateStage(caller, {
      harnessId: scene.harnessId,
      stageKey: 'build',
      change: { instructionsPageId: pageId },
    });
    expect(created).toMatchObject({ status: 'error', reason: 'page_not_found' });
    expect(updated).toMatchObject({ status: 'error', reason: 'page_not_found' });
  }
  expect(await eventCount(db, scene.harnessId)).toBe(before);
}

describe.skipIf(!testServer)('a stage instructions page a command names', () => {
  it('a missing, hidden, other-area or issue page answers page_not_found byte-identically on create_stage and update_stage, and records nothing', () =>
    withAppDatabase(everyUnusablePageAnswersAlike));

  it('an admin cannot bind a page in another area as stage instructions, so cannot freeze agent writes to it', () =>
    withAppDatabase(noAdminFreezesAnotherArea));

  it('a page in the harness area that the admin reads becomes the stage instructions', () =>
    withAppDatabase(samePageIsNamed));

  it('the kernel refuses a page it cannot use as instructions before the foreign key fires', () =>
    withAppDatabase(kernelRefusesBeforeTheKey));
});

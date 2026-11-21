import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pageReadReplySchema, type Page } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant } from '@uw/db/test-seed';
import { get, person, post } from '../testing/commands.ts';
import { fileKnowledge, knowledgeBody } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const MOVE = '/api/pages/commands/move_page';

type World = { readonly both: string; readonly homeOnly: string; readonly pageId: string };

async function alsoEdits(db: Database, personId: string, area: string): Promise<void> {
  await seedGrant(db, {
    id: randomUUID(),
    personId,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
}

async function world(db: Database): Promise<World> {
  const both = await person(db, 'move-both', 'editor', '00-09');
  await alsoEdits(db, both.id, '60-69');
  const homeOnly = await person(db, 'move-home', 'editor', '00-09');
  const filed = await fileKnowledge(db, both.email, '01', {
    title: 'Field visit checklist',
    frontmatter: { jd_category: '01', jd_id: '01.07', tags: ['field'] },
  });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  return { both: both.email, homeOnly: homeOnly.email, pageId: filed.pageId };
}

function move(pageId: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    command: 'move_page',
    requestId: randomUUID(),
    pageId,
    expectedVersion: 1,
    category: '61',
    parentId: null,
    ...overrides,
  };
}

async function read(db: Database, email: string, pageId: string): Promise<Page> {
  const sent = await get(db, { email }, `/api/pages/${pageId}`);
  return pageReadReplySchema.parse(sent.body).page;
}

async function movesAcrossAreas(db: Database): Promise<void> {
  const made = await world(db);
  const command = move(made.pageId);
  const sent = await post(db, made.both, MOVE, command);
  expect(sent.body).toMatchObject({ status: 'accepted', pageId: made.pageId, version: 2 });
  const page = await read(db, made.both, made.pageId);
  expect(page.jdArea).toBe('60-69');
  expect(page.frontmatter).toMatchObject({ jd_category: '61', jd_id: null, tags: ['field'] });
  expect(page.title).toBe('Field visit checklist');
  const again = await post(db, made.both, MOVE, command);
  expect(again.body).toMatchObject({ status: 'accepted', version: 2 });
  const versions = await get(db, { email: made.both }, `/api/pages/${made.pageId}/versions`);
  expect((versions.body['versions'] as unknown[]).length).toBe(2);
  const gone = await get(db, { email: made.homeOnly }, `/api/pages/${made.pageId}`);
  expect(gone.status).toBe(404);
}

async function needsWriteOnBothAreas(db: Database): Promise<void> {
  const made = await world(db);
  const refused = await post(db, made.homeOnly, MOVE, move(made.pageId));
  expect(refused.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const stale = await post(db, made.both, MOVE, move(made.pageId, { expectedVersion: 4 }));
  expect(stale.body).toMatchObject({ status: 'error', reason: 'stale_version' });
  expect((await read(db, made.both, made.pageId)).jdArea).toBe('00-09');
}

async function keepsTheTreeSound(db: Database): Promise<void> {
  const made = await world(db);
  const child = await fileKnowledge(db, made.both, '01', { parentId: made.pageId });
  const under = move(made.pageId, { category: '01', parentId: child.pageId });
  const cycle = await post(db, made.both, MOVE, under);
  expect(cycle.body).toMatchObject({ status: 'error', reason: 'parent_cycle' });
  const sibling = await fileKnowledge(db, made.both, '02', { title: 'Another page' });
  const nested = move(child.pageId, { category: '02', parentId: sibling.pageId });
  const sent = await post(db, made.both, MOVE, nested);
  expect(sent.body).toMatchObject({ status: 'accepted', version: 2 });
  const page = await read(db, made.both, child.pageId);
  expect([page.parentId, page.frontmatter['jd_category']]).toEqual([sibling.pageId, '02']);
}

async function movesOnlyKnowledgePages(db: Database): Promise<void> {
  const made = await world(db);
  const skill = {
    ...knowledgeBody('01'),
    type: 'skill',
    frontmatter: { name: 'write-notes', description: 'Draft notes.' },
    status: 'draft',
  };
  const filed = await post(db, made.both, '/api/pages/commands/create_page', skill);
  expect(filed.body).toMatchObject({ status: 'accepted' });
  const refused = await post(db, made.both, MOVE, move(skill.pageId));
  expect(refused.body).toMatchObject({ status: 'error', reason: 'invalid_frontmatter' });
  const malformed = await post(db, made.both, MOVE, move(made.pageId, { category: '6' }));
  expect(malformed.status).toBe(400);
}

describe.skipIf(!testServer)('#175 a knowledge page moves to another category', () => {
  it('moves across areas as one version, keeps its text, and drops its JD ID', () =>
    withAppDatabase(movesAcrossAreas));

  it('needs the editor role in both areas and the current version', () =>
    withAppDatabase(needsWriteOnBothAreas));

  it('refuses a parent that would make a loop, and files under a page elsewhere', () =>
    withAppDatabase(keepsTheTreeSound));

  it('moves knowledge pages only', () => withAppDatabase(movesOnlyKnowledgePages));
});

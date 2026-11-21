import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { get, person, post } from '../testing/commands.ts';
import { fileKnowledge, knowledgeBody } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

async function areaOf(db: Database, pageId: string): Promise<string | undefined> {
  const rows = await db.execute<{ jd_area: string }>(
    sql`SELECT jd_area FROM pages WHERE id = ${pageId}`,
  );
  return rows[0]?.jd_area;
}

async function landsInTheDecadeOfItsCategory(db: Database): Promise<void> {
  const sixties = await person(db, 'field-a', 'editor', '60-69');
  const seventies = await person(db, 'field-b', 'editor', '70-79');
  const first = await fileKnowledge(db, sixties.email, '61');
  const second = await fileKnowledge(db, seventies.email, '74');
  expect(first.sent.body).toMatchObject({ status: 'accepted' });
  expect(second.sent.body).toMatchObject({ status: 'accepted' });
  expect(await areaOf(db, first.pageId)).toBe('60-69');
  expect(await areaOf(db, second.pageId)).toBe('70-79');
}

async function refusesAPageWithNoCategoryAnd(db: Database): Promise<void> {
  const editor = await person(db, 'field-c', 'editor', '60-69');
  const none = await fileKnowledge(db, editor.email, '61', { frontmatter: {} });
  expect(none.sent.body).toMatchObject({ status: 'error', reason: 'invalid_frontmatter' });
  const elsewhere = await fileKnowledge(db, editor.email, '74', { jdArea: '60-69' });
  expect(elsewhere.sent.body).toMatchObject({ status: 'error', reason: 'invalid_frontmatter' });
  expect(await areaOf(db, none.pageId)).toBeUndefined();
  expect(await areaOf(db, elsewhere.pageId)).toBeUndefined();
}

async function refusesAnEditorOf6069Filing(db: Database): Promise<void> {
  const editor = await person(db, 'field-d', 'editor', '60-69');
  const sent = await fileKnowledge(db, editor.email, '74');
  expect(sent.sent.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
}

async function refusesASaveThatMovesTheCategory(db: Database): Promise<void> {
  const editor = await person(db, 'field-e', 'editor', '60-69');
  const filed = await fileKnowledge(db, editor.email, '61');
  const body = knowledgeBody('61');
  const moved = await post(db, editor.email, '/api/pages/commands/update_page', {
    command: 'update_page',
    requestId: randomUUID(),
    pageId: filed.pageId,
    expectedVersion: 1,
    slug: body.slug,
    title: body.title,
    parentId: null,
    frontmatter: { jd_category: '74' },
    bodyMd: body.bodyMd,
    status: 'active',
  });
  expect(moved.body).toMatchObject({ status: 'error', reason: 'invalid_frontmatter' });
  const within = await post(db, editor.email, '/api/pages/commands/update_page', {
    command: 'update_page',
    requestId: randomUUID(),
    pageId: filed.pageId,
    expectedVersion: 1,
    slug: body.slug,
    title: body.title,
    parentId: null,
    frontmatter: { jd_category: '62', jd_id: '62.03' },
    bodyMd: body.bodyMd,
    status: 'active',
  });
  expect(within.body).toMatchObject({ status: 'accepted' });
  const read = await get(db, { email: editor.email }, `/api/pages/${filed.pageId}`);
  expect(read.body['page']).toMatchObject({
    jdArea: '60-69',
    frontmatter: { jd_category: '62', jd_id: '62.03' },
  });
}

describe.skipIf(!testServer)('a knowledge page is filed in a category', () => {
  it('lands in the decade of its category, so 61 is in 60-69 and 74 is in 70-79', () =>
    withAppDatabase(landsInTheDecadeOfItsCategory));

  it('refuses a page with no category, and one whose area is not its category decade', () =>
    withAppDatabase(refusesAPageWithNoCategoryAnd));

  it('refuses an editor of 60-69 filing in 70-79: a grant is on one decade of the cluster', () =>
    withAppDatabase(refusesAnEditorOf6069Filing));
});

describe.skipIf(!testServer)('a knowledge page stays in its area when it is saved', () => {
  it('refuses a save that moves the category out of the page area', () =>
    withAppDatabase(refusesASaveThatMovesTheCategory));
});

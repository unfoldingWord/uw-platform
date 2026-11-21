import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { pageReadReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, person, post } from '../testing/commands.ts';
import { fileKnowledge, knowledgeBody } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const MARKED = '<p>Served from the cache.</p>';

type World = {
  readonly editor: string;
  readonly outsider: string;
  readonly hostId: string;
  readonly sourceId: string;
  readonly linkedId: string;
};

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'cache-editor', 'editor', '00-09');
  const outsider = await person(db, 'cache-outsider', 'viewer', '00-09');
  const finance = await person(db, 'cache-finance', 'editor', '20-29');
  await db.execute(sql`INSERT INTO role_grants (person_id, role, scope_kind, scope_area)
    VALUES (${await idOf(db, editor.email)}::uuid, 'viewer', 'jd_area', '20-29')`);
  const source = await fileKnowledge(db, finance.email, '21', {
    title: '21.10 Rolling Budget',
    bodyMd: '## Income\n\nRow 30 is income.',
  });
  const linked = await fileKnowledge(db, editor.email, '01', { title: 'Travel policy' });
  const host = await fileKnowledge(db, editor.email, '01', {
    title: 'Finance overview',
    bodyMd: `See [[Travel policy]] and [[Per diem rates]].\n\n![Budget](/pages/${source.pageId}#income)`,
  });
  expect(host.sent.body).toMatchObject({ status: 'accepted' });
  return {
    editor: editor.email,
    outsider: outsider.email,
    hostId: host.pageId,
    sourceId: source.pageId,
    linkedId: linked.pageId,
  };
}

async function idOf(db: Database, email: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM people WHERE email = ${email}`);
  return rows[0]?.id ?? '';
}

async function html(db: Database, email: string, pageId: string): Promise<string> {
  const sent = await get(db, { email }, `/api/pages/${pageId}?format=html`);
  return pageReadReplySchema.parse(sent.body).html ?? '';
}

async function stored(db: Database, pageId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM page_renders WHERE page_id = ${pageId}::uuid`,
  );
  return rows[0]?.n ?? 0;
}

async function mark(db: Database, pageId: string): Promise<void> {
  await db.execute(sql`UPDATE page_renders SET html = ${MARKED} WHERE page_id = ${pageId}::uuid`);
}

async function update(
  db: Database,
  email: string,
  pageId: string,
  change: Record<string, unknown>,
) {
  const read = await get(db, { email }, `/api/pages/${pageId}`);
  const { page } = pageReadReplySchema.parse(read.body);
  const sent = await post(db, email, '/api/pages/commands/update_page', {
    command: 'update_page',
    requestId: randomUUID(),
    pageId,
    expectedVersion: page.version,
    slug: page.slug,
    title: page.title,
    parentId: page.parentId,
    frontmatter: page.frontmatter,
    bodyMd: page.bodyMd,
    status: page.status,
    ...change,
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
}

async function aSecondReadComesFromTheCache(db: Database): Promise<void> {
  const made = await world(db);
  const first = await html(db, made.editor, made.hostId);
  expect(first).toContain('Row 30 is income.');
  expect(await stored(db, made.hostId)).toBe(1);
  await mark(db, made.hostId);
  expect(await html(db, made.editor, made.hostId)).toBe(MARKED);
  expect(await stored(db, made.hostId)).toBe(1);
}

async function aNewVersionOrSourceIsNeverStale(db: Database): Promise<void> {
  const made = await world(db);
  await html(db, made.editor, made.hostId);
  await mark(db, made.hostId);
  await update(db, made.editor, made.hostId, { bodyMd: 'A new body.' });
  expect(await html(db, made.editor, made.hostId)).toContain('A new body.');
  await update(db, made.editor, made.hostId, {
    bodyMd: `![Budget](/pages/${made.sourceId}#income)`,
  });
  await html(db, made.editor, made.hostId);
  await mark(db, made.hostId);
  const finance = 'cache-finance@unfoldingword.org';
  await update(db, finance, made.sourceId, { bodyMd: '## Income\n\nRow 31 is income now.' });
  const after = await html(db, made.editor, made.hostId);
  expect(after).toContain('Row 31 is income now.');
}

async function renamesAndNewPagesShowAtOnce(db: Database): Promise<void> {
  const made = await world(db);
  expect(await html(db, made.editor, made.hostId)).toContain(
    'href="/wiki/new?title=Per%20diem%20rates"',
  );
  await mark(db, made.hostId);
  const perDiem = knowledgeBody('01', { title: 'Per diem rates' });
  await post(db, made.editor, '/api/pages/commands/create_page', perDiem);
  expect(await html(db, made.editor, made.hostId)).toContain(`href="/pages/${perDiem.pageId}"`);
  await mark(db, made.hostId);
  await update(db, made.editor, made.linkedId, { title: 'Travel rules' });
  expect(await html(db, made.editor, made.hostId)).toContain('>Travel rules</a>');
}

async function eachReaderSeesOnlyWhatTheyMay(db: Database): Promise<void> {
  const made = await world(db);
  expect(await html(db, made.editor, made.hostId)).toContain('Row 30 is income.');
  const hidden = await html(db, made.outsider, made.hostId);
  expect(hidden).not.toContain('Row 30');
  expect(hidden).toContain('You do not have access to this section.');
  expect(await stored(db, made.hostId)).toBe(2);
}

describe.skipIf(!testServer)('#175 a rendered page is cached and never served stale', () => {
  it('serves a second read of the same page from the cache', () =>
    withAppDatabase(aSecondReadComesFromTheCache));

  it('renders again after a new version of the page or of a section it embeds', () =>
    withAppDatabase(aNewVersionOrSourceIsNeverStale));

  it('shows a renamed link and a newly created link target at once', () =>
    withAppDatabase(renamesAndNewPagesShowAtOnce));

  it('keeps one render per kind of reader, so no one sees a section they may not', () =>
    withAppDatabase(eachReaderSeesOnlyWhatTheyMay));
});

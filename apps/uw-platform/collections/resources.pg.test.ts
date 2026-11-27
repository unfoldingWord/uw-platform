import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { WEBSITES_VIEW_ID, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createPage } from '../pages/store.ts';
import { collectionsAt, personWith, rowIn } from '../testing/collections.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { ensureBuiltIns } from './builtins/seed.ts';
import { allCollections, loadCollection } from './definitions.ts';
import { viewRows } from './replies.ts';
import { viewRow } from './view-rows.ts';

const PROGRAM_AREA = '60-69';

type Rig = { readonly ana: Principal; readonly ben: Principal };

function withRig(work: (db: Database, rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    await ensureBuiltIns(db, collectionsAt);
    const ana = await personWith(db, 'ana', [
      { role: 'editor', area: '00-09' },
      { role: 'editor', area: PROGRAM_AREA },
    ]);
    const ben = await personWith(db, 'ben', [{ role: 'viewer', area: '00-09' }]);
    await work(db, { ana, ben });
  });
}

async function websites(db: Database, actor: Principal): Promise<string[]> {
  const stored = await loadCollection(db, 'resource');
  if (stored === null) throw new Error('no resources collection');
  const read = await viewRows(db, stored, actor, collectionsAt, {
    viewId: WEBSITES_VIEW_ID,
    limit: 50,
    cursor: null,
  });
  if (!read.ok) throw new Error(read.reason);
  return read.value.rows.map((row) => row.title);
}

async function servedBy(db: Database, resource: string): Promise<string[]> {
  const rows = await db.execute<{ rel: string; to_page: string }>(
    sql`SELECT rel, to_page FROM page_links WHERE from_page = ${resource} ORDER BY rel`,
  );
  return rows.map((row) => `${row.rel} ${row.to_page}`);
}

async function provesResources(db: Database, { ana, ben }: Rig): Promise<void> {
  const program = await rowIn(db, ana, {
    collection: 'program',
    jdArea: PROGRAM_AREA,
    title: 'Gateway languages',
  });
  const project = await rowIn(db, ana, {
    collection: 'project',
    jdArea: PROGRAM_AREA,
    title: 'unfoldingWord website',
  });
  const site = await rowIn(db, ana, {
    collection: 'resource',
    jdArea: PROGRAM_AREA,
    title: 'unfoldingword.org',
    values: {
      kind: 'website',
      address: 'https://unfoldingword.org',
      serves_project: [project],
      serves_program: [program],
    },
  });
  await rowIn(db, ana, {
    collection: 'resource',
    jdArea: PROGRAM_AREA,
    title: 'translationCore',
    values: { kind: 'mobile_app', address: 'https://example.org/apps/translationcore' },
  });
  expect(await servedBy(db, site)).toEqual([
    `resource.serves_program ${program}`,
    `resource.serves_project ${project}`,
  ]);
  expect(await websites(db, ana)).toEqual(['unfoldingword.org']);
  expect(await websites(db, ben)).toEqual([]);
}

async function provesRowsOnly(db: Database, { ana }: Rig): Promise<void> {
  const pageId = randomUUID();
  const command = {
    command: 'create_page' as const,
    requestId: randomUUID(),
    pageId,
    type: 'resource',
    jdArea: PROGRAM_AREA,
    slug: 'unfoldingword-org',
    title: 'unfoldingword.org',
    parentId: null,
    frontmatter: {},
    bodyMd: '',
    status: 'draft' as const,
  };
  const created = await createPage(db, ana, command, randomUUID(), collectionsAt);
  expect(created).toMatchObject({ ok: false, reason: 'collection_row' });
}

async function provesLateSeeding(db: Database): Promise<void> {
  await ensureBuiltIns(db, collectionsAt);
  await db.execute(sql`DELETE FROM collections WHERE key = 'resource'`);
  const before = (await allCollections(db)).map((stored) => stored.definition.key);
  expect(before).not.toContain('resource');
  await ensureBuiltIns(db, collectionsAt);
  const after = (await allCollections(db)).map((stored) => stored.definition.key);
  expect(after.filter((key) => !before.includes(key))).toEqual(['resource']);
  const stored = await loadCollection(db, 'resource');
  expect((await viewRow(db, WEBSITES_VIEW_ID))?.collectionId).toBe(stored?.id);
}

describe.skipIf(!testServer)('ADR 0036 the built-in Resources collection', () => {
  it('relates a site to the program and project it serves and lists websites by area', () =>
    withRig(provesResources));

  it('makes a resource only as a row, never through the page API', () => withRig(provesRowsOnly));

  it('is seeded into a database that already holds the other built-ins, as staging does', () =>
    withAppDatabase(provesLateSeeding));
});

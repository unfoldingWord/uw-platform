import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { CreatePageCommand, PageStatus, PageType, Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { createPage, updatePage } from './store.ts';

const EDITOR = {
  id: '00000000-0000-4000-8000-000000002701',
  email: 'gated-editor@unfoldingword.org',
};
const AREA = '80-89';

const frontmatterByType = new Map<PageType, CreatePageCommand['frontmatter']>([
  ['skill', { name: 'write-notes', description: 'Draft notes.' }],
  ['learning', { confidence: 'observed', as_of: '2026-10-01', supersedes: [], review_by: null }],
  [
    'persona',
    {
      identity: 'agent:builder',
      owner: `human:${EDITOR.id}`,
      harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
      toolset: ['read_page'],
      run_shape: 'workflow-run',
      engine: 'openrouter-messages',
      model: 'glm-5.3-flash',
      budget: { monthly_minor: 5000, currency: 'USD' },
      capability: 'build',
      requires_tools: ['read_page'],
    },
  ],
  ['product', { owner: `human:${EDITOR.id}`, summary: 'A product page.' }],
]);

const gated: readonly PageType[] = ['persona', 'learning', 'skill'];
const activationRequired = {
  ok: false,
  reason: 'not_permitted',
  detail: { why: 'activation_required' },
};

function frontmatterOf(type: PageType): CreatePageCommand['frontmatter'] {
  const frontmatter = frontmatterByType.get(type);
  if (frontmatter === undefined) throw new Error(`no frontmatter fixture for ${type}`);
  return frontmatter;
}

async function editor(db: Database): Promise<Principal> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002711',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: AREA,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return personOn(db, EDITOR.id, EDITOR.email, new Date());
}

function create(db: Database, person: Principal, type: PageType, status: PageStatus) {
  const pageId = crypto.randomUUID();
  const command = {
    command: 'create_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    type,
    jdArea: AREA,
    slug: `${type}-${pageId.slice(0, 8)}`,
    title: `A ${type} page`,
    parentId: null,
    frontmatter: frontmatterOf(type),
    bodyMd: 'Body.',
    status,
  };
  return { pageId, created: createPage(db, person, command, crypto.randomUUID(), new Date()) };
}

async function seededAs(db: Database, type: PageType, status: PageStatus): Promise<string> {
  const id = crypto.randomUUID();
  const slug = `seeded-${id.slice(0, 8)}`;
  const frontmatter = frontmatterOf(type);
  await seedPage(db, {
    id,
    type,
    status,
    jdArea: AREA,
    slug,
    title: 'Seeded',
    bodyMd: 'Seeded.',
    frontmatter,
  });
  return id;
}

function update(
  db: Database,
  person: Principal,
  pageId: string,
  type: PageType,
  status: PageStatus,
) {
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    expectedVersion: 1,
    slug: `edited-${pageId.slice(0, 8)}`,
    title: 'Edited',
    parentId: null,
    frontmatter: frontmatterOf(type),
    bodyMd: 'Edited.',
    status,
  };
  return updatePage(db, person, command, crypto.randomUUID(), new Date());
}

async function stored(db: Database, pageId: string) {
  const rows = await db.execute<{ status: string; version: number }>(
    sql`SELECT status, version FROM pages WHERE id = ${pageId}`,
  );
  const versions = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM page_versions WHERE page_id = ${pageId}`,
  );
  return { row: rows[0] ?? null, versions: versions[0]?.n ?? 0 };
}

describe.skipIf(!testServer)(
  'AB-5 AB-8 a gated page never becomes active through the page API',
  () => {
    it.each(gated)('refuses creating a %s page as active and writes nothing', (type) =>
      withAppDatabase(async (db) => {
        const person = await editor(db);
        const { pageId, created } = create(db, person, type, 'active');
        expect(await created).toEqual(activationRequired);
        expect(await stored(db, pageId)).toEqual({ row: null, versions: 0 });
      }),
    );

    it.each(gated)('refuses moving a suggested %s page to active and leaves it suggested', (type) =>
      withAppDatabase(async (db) => {
        const person = await editor(db);
        const pageId = await seededAs(db, type, 'suggested');
        expect(await update(db, person, pageId, type, 'active')).toEqual(activationRequired);
        expect(await stored(db, pageId)).toEqual({
          row: { status: 'suggested', version: 1 },
          versions: 0,
        });
      }),
    );
  },
);

describe.skipIf(!testServer)('AB-5 the page API still writes gated pages short of active', () => {
  it.each(gated)('creates a %s page as draft and edits an active one in place', (type) =>
    withAppDatabase(async (db) => {
      const person = await editor(db);
      expect((await create(db, person, type, 'draft').created).ok).toBe(true);
      const active = await seededAs(db, type, 'active');
      expect((await update(db, person, active, type, 'active')).ok).toBe(true);
    }),
  );

  it('creates an ungated product page as active', () =>
    withAppDatabase(async (db) => {
      const person = await editor(db);
      expect((await create(db, person, 'product', 'active').created).ok).toBe(true);
    }));
});

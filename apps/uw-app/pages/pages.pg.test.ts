import { randomUUID } from 'node:crypto';
import { getTableName, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { pages, pageVersions } from '@uw/db/schema';
import { createApp } from '../app.tsx';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { owns } from './store.ts';

const IAN = 'ian.lindsley@unfoldingword.org';
const ED = 'ed@unfoldingword.org';
const VW = 'vw@unfoldingword.org';
const FIN = 'fin@unfoldingword.org';
const FV = 'fv@unfoldingword.org';
const AREA = '80-89';
const OTHER_AREA = '20-29';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

type Sent = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly traceId: string;
};

async function send(db: Database, email: string, path: string, init: RequestInit): Promise<Sent> {
  const token = await fixture.sign({ email });
  const raw = await createApp(postgresDeps(db, fixture)).request(
    path,
    {
      ...init,
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
    },
    fixtureAccessEnv,
  );
  const body = (await raw.json()) as Record<string, unknown>;
  return { status: raw.status, body, traceId: raw.headers.get('x-trace-id') ?? '' };
}

function post(db: Database, email: string, path: string, body: unknown): Promise<Sent> {
  return send(db, email, path, { method: 'POST', body: JSON.stringify(body) });
}

function get(db: Database, email: string, path: string): Promise<Sent> {
  return send(db, email, path, { method: 'GET' });
}

async function personId(db: Database, email: string): Promise<string> {
  await get(db, email, '/api/me');
  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM people WHERE email = ${email}`);
  return rows[0]?.id ?? '';
}

async function grant(db: Database, email: string, role: string, area: string): Promise<void> {
  const sent = await post(db, IAN, '/api/acl/commands/grant_role', {
    command: 'grant_role',
    requestId: randomUUID(),
    personId: await personId(db, email),
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    expiresAt: null,
  });
  expect(sent.status).toBe(200);
}

async function seedPeople(db: Database): Promise<void> {
  await grant(db, ED, 'editor', AREA);
  await grant(db, VW, 'viewer', AREA);
  await grant(db, FIN, 'editor', OTHER_AREA);
  await grant(db, FV, 'viewer', OTHER_AREA);
}

const skillFrontmatter = { name: 'write-notes', description: 'Draft notes.' };

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    command: 'create_page',
    requestId: randomUUID(),
    pageId: randomUUID(),
    type: 'skill',
    jdArea: AREA,
    slug: `slug-${randomUUID().slice(0, 8)}`,
    title: 'A page',
    parentId: null,
    frontmatter: skillFrontmatter,
    bodyMd: 'Body.',
    status: 'draft',
    ...overrides,
  };
}

function updateBody(pageId: string, overrides: Record<string, unknown> = {}) {
  return {
    command: 'update_page',
    requestId: randomUUID(),
    pageId,
    expectedVersion: 1,
    slug: `slug-${randomUUID().slice(0, 8)}`,
    title: 'Edited',
    parentId: null,
    frontmatter: skillFrontmatter,
    bodyMd: 'Edited.',
    status: 'draft',
    ...overrides,
  };
}

function create(db: Database, email: string, overrides: Record<string, unknown> = {}) {
  return post(db, email, '/api/pages/commands/create_page', createBody(overrides));
}

function update(db: Database, email: string, pageId: string, overrides = {}) {
  return post(db, email, '/api/pages/commands/update_page', updateBody(pageId, overrides));
}

async function seeded(db: Database, overrides: Record<string, unknown> = {}): Promise<string> {
  const pageId = randomUUID();
  const sent = await create(db, ED, { pageId, ...overrides });
  expect(sent.status).toBe(200);
  return pageId;
}

function reasonOf(sent: Sent): [number, unknown] {
  return [sent.status, sent.body['reason']];
}

async function versionRows(db: Database, pageId: string) {
  return db.execute<{ version: number; edit_source: string; trace_id: string }>(
    sql`SELECT version, edit_source, trace_id FROM page_versions WHERE page_id = ${pageId} ORDER BY version`,
  );
}

async function versionNumbers(db: Database, pageId: string): Promise<number[]> {
  const rows = await versionRows(db, pageId);
  return rows.map((row) => row.version);
}

async function pageCount(db: Database): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pages`);
  return rows[0]?.n ?? 0;
}

const personaFrontmatter = {
  identity: 'agent:builder',
  owner: 'human:00000000-0000-4000-8000-000000000001',
  harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  toolset: ['read_page'],
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'glm-5.3-flash',
  budget: { monthly_minor: 5000, currency: 'USD' },
  capability: 'build',
  requires_tools: ['read_page'],
};

const learningFrontmatter = {
  confidence: 'observed',
  as_of: '2026-10-01',
  supersedes: [],
  review_by: null,
};

describe('FD-9 the pages module is the only writer of pages and page versions', () => {
  it('declares exactly pages and page_versions as owned', () => {
    expect(owns).toEqual([getTableName(pages), getTableName(pageVersions)]);
  });
});

describe.skipIf(!testServer)('FD-9 create_page', () => {
  it('creates a persona at version 1 with one snapshot carrying identity and trace id', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = randomUUID();
      const sent = await create(db, ED, {
        pageId,
        type: 'persona',
        frontmatter: personaFrontmatter,
      });
      expect(sent.status).toBe(200);
      const read = await get(db, ED, `/api/pages/${pageId}`);
      expect(read.status).toBe(200);
      expect(read.body['page']).toMatchObject({
        id: pageId,
        version: 1,
        frontmatter: personaFrontmatter,
      });
      const edId = await personId(db, ED);
      expect(await versionRows(db, pageId)).toEqual([
        { version: 1, edit_source: `human:${edId}`, trace_id: sent.traceId },
      ]);
    }));

  it('creates a skill and a learning page', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      expect((await create(db, ED)).status).toBe(200);
      const learning = await create(db, ED, { type: 'learning', frontmatter: learningFrontmatter });
      expect(learning.status).toBe(200);
    }));
});

describe.skipIf(!testServer)('FD-9 create_page refusals', () => {
  it('refuses an unknown type and an invalid frontmatter, writing nothing', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const unknown = await create(db, ED, { type: 'policy' });
      const invalid = await create(db, ED, {
        type: 'persona',
        frontmatter: { ...personaFrontmatter, toolset: ['Approve'] },
      });
      expect(reasonOf(unknown)).toEqual([422, 'unknown_page_type']);
      expect(reasonOf(invalid)).toEqual([422, 'invalid_frontmatter']);
      expect(await pageCount(db)).toBe(0);
    }));

  it('refuses a viewer and an editor of another area', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      expect(reasonOf(await create(db, VW))).toEqual([403, 'not_permitted']);
      expect(reasonOf(await create(db, ED, { jdArea: OTHER_AREA }))).toEqual([
        403,
        'not_permitted',
      ]);
      expect(await pageCount(db)).toBe(0);
    }));
});

describe.skipIf(!testServer)('FD-9 create_page conflicts and parents', () => {
  it('refuses a slug taken in the area and allows it in another', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      await seeded(db, { slug: 'shared' });
      const again = await create(db, ED, { slug: 'shared' });
      expect(reasonOf(again)).toEqual([409, 'slug_taken']);
      const elsewhere = await create(db, FIN, { slug: 'shared', jdArea: OTHER_AREA });
      expect(elsewhere.status).toBe(200);
    }));

  it('refuses an existing page id', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = await seeded(db);
      expect(reasonOf(await create(db, ED, { pageId }))).toEqual([409, 'page_exists']);
    }));

  it('refuses a parent that does not exist', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const sent = await create(db, ED, { parentId: randomUUID() });
      expect(reasonOf(sent)).toEqual([422, 'parent_not_found']);
    }));
});

describe.skipIf(!testServer)('FD-9 reading a page', () => {
  it('shows a page to a reader elsewhere and hides it from a viewer elsewhere', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = await seeded(db);
      expect((await get(db, FIN, `/api/pages/${pageId}`)).status).toBe(200);
      const hidden = await get(db, FV, `/api/pages/${pageId}`);
      expect(reasonOf(hidden)).toEqual([404, 'page_not_found']);
    }));

  it('answers 404 for an id that is not a UUID and for an unknown command', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      expect(reasonOf(await get(db, ED, '/api/pages/not-a-uuid'))).toEqual([404, 'page_not_found']);
      const unwired = await post(db, ED, '/api/pages/commands/delete_page', {});
      expect(reasonOf(unwired)).toEqual([404, 'not_wired']);
    }));
});

describe.skipIf(!testServer)('FD-9 update_page', () => {
  it('writes version 2 with a second snapshot, then refuses a stale version', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = await seeded(db);
      expect((await update(db, ED, pageId)).status).toBe(200);
      const read = await get(db, ED, `/api/pages/${pageId}`);
      expect(read.body['page']).toMatchObject({ version: 2, title: 'Edited' });
      expect(await versionNumbers(db, pageId)).toEqual([1, 2]);
      const stale = await update(db, ED, pageId);
      expect(reasonOf(stale)).toEqual([409, 'stale_version']);
      expect(await versionRows(db, pageId)).toHaveLength(2);
    }));

  it('refuses a slug taken in the area', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      await seeded(db, { slug: 'first' });
      const second = await seeded(db, { slug: 'second' });
      expect(reasonOf(await update(db, ED, second, { slug: 'first' }))).toEqual([
        409,
        'slug_taken',
      ]);
    }));

  it('refuses a viewer, an editor of another area, and a page the caller cannot read', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = await seeded(db);
      expect(reasonOf(await update(db, VW, pageId))).toEqual([403, 'not_permitted']);
      expect(reasonOf(await update(db, FIN, pageId))).toEqual([403, 'not_permitted']);
      expect(reasonOf(await update(db, FV, pageId))).toEqual([404, 'page_not_found']);
    }));

  it('validates frontmatter against the stored type', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = await seeded(db);
      const sent = await update(db, ED, pageId, { frontmatter: { name: 'x' } });
      expect(reasonOf(sent)).toEqual([422, 'invalid_frontmatter']);
    }));
});

const PAIRS = 12;

async function seededPair(db: Database): Promise<[string, string]> {
  return [await seeded(db), await seeded(db)];
}

function statusesOf(results: Sent[]): number[] {
  return results.map((sent) => sent.status).sort();
}

function refusalReasons(results: Sent[]): unknown[] {
  return results.map((sent) => sent.body['reason']).filter(Boolean);
}

function parentedCount(rows: { parent_id: string | null }[]): number {
  return rows.filter((row) => row.parent_id !== null).length;
}

async function racePairs(db: Database) {
  const pairs = await Promise.all(Array.from({ length: PAIRS }, () => seededPair(db)));
  return Promise.all(pairs.map(([x, y]) => raceReparenting(db, x, y)));
}

async function raceReparenting(db: Database, x: string, y: string) {
  const results = await Promise.all([
    update(db, ED, x, { parentId: y }),
    update(db, ED, y, { parentId: x }),
  ]);
  const rows = await db.execute<{ parent_id: string | null }>(
    sql`SELECT parent_id FROM pages WHERE id IN (${x}, ${y})`,
  );
  return {
    statuses: statusesOf(results),
    reasons: refusalReasons(results),
    parented: parentedCount(rows),
  };
}

describe.skipIf(!testServer)('FD-9 update_page parents', () => {
  it('refuses a page made its own parent', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = await seeded(db);
      const sent = await update(db, ED, pageId, { parentId: pageId });
      expect(reasonOf(sent)).toEqual([422, 'parent_cycle']);
    }));

  it('refuses a parent that is a descendant', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const parent = await seeded(db);
      const child = await seeded(db, { parentId: parent });
      const sent = await update(db, ED, parent, { parentId: child });
      expect(reasonOf(sent)).toEqual([422, 'parent_cycle']);
    }));

  it('refuses a parent the caller cannot see', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const pageId = await seeded(db);
      const sent = await update(db, ED, pageId, { parentId: randomUUID() });
      expect(reasonOf(sent)).toEqual([422, 'parent_not_found']);
    }));

  it('lets two concurrent updates make at most one half of a cycle', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const outcomes = await racePairs(db);
      for (const outcome of outcomes) {
        expect(outcome.statuses).toEqual([200, 422]);
        expect(outcome.reasons).toEqual(['parent_cycle']);
        expect(outcome.parented).toBe(1);
      }
    }));
});

describe.skipIf(!testServer)('AB-5 the page routes never activate a gated page', () => {
  it('answers create_page and update_page into active activation_required, writing nothing', () =>
    withAppDatabase(async (db) => {
      await seedPeople(db);
      const before = await pageCount(db);
      expect(reasonOf(await create(db, ED, { status: 'active' }))).toEqual([
        403,
        'activation_required',
      ]);
      expect(await pageCount(db)).toBe(before);
      const pageId = await seeded(db);
      expect(reasonOf(await update(db, ED, pageId, { status: 'active' }))).toEqual([
        403,
        'activation_required',
      ]);
      expect(await versionNumbers(db, pageId)).toEqual([1]);
    }));
});

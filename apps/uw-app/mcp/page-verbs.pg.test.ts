import { afterAll, describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson, type SeedPage } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import { writePageAsAgent } from '../pages/agent-write.ts';
import { updatePage } from '../pages/store.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const EDITOR = {
  id: '00000000-0000-4000-8000-000000001401',
  email: 'pages-editor@unfoldingword.org',
};
const VIEWER = {
  id: '00000000-0000-4000-8000-000000001402',
  email: 'pages-viewer@unfoldingword.org',
};
const MISSING = '00000000-0000-4000-8000-000000001499';
const SEEDED = {
  workshop80: '00000000-0000-4000-8000-000000001410',
  workshop30: '00000000-0000-4000-8000-000000001411',
  lesson80: '00000000-0000-4000-8000-000000001412',
  persona80: '00000000-0000-4000-8000-000000001413',
};
const GRANTED_AT = new Date('2026-01-01T00:00:00.000Z');

type Body = Record<string, unknown>;
type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly connectionString: string;
  readonly drop: () => Promise<void>;
};

let rigged: Promise<Rig> | null = null;

const productFrontmatter = {
  owner: `human:${EDITOR.id}`,
  summary: 'A product page an agent writes.',
};
const learningFrontmatter = {
  confidence: 'observed',
  as_of: '2026-10-01',
  supersedes: [],
  review_by: null,
};
const personaFrontmatter = {
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
};

function grant(n: number, personId: string, role: 'editor' | 'viewer', area: string) {
  const id = `00000000-0000-4000-8000-0000000014${String(n).padStart(2, '0')}`;
  return {
    id,
    personId,
    role,
    scopeKind: 'jd_area' as const,
    scopeArea: area,
    grantedAt: GRANTED_AT,
    expiresAt: null,
  };
}

function seeded(id: string, page: Partial<SeedPage>): SeedPage {
  return {
    id,
    type: 'product',
    status: 'draft',
    jdArea: '80-89',
    slug: `seeded-${id.slice(-4)}`,
    title: 'A seeded page',
    bodyMd: 'The harvest workshop notes.',
    frontmatter: productFrontmatter,
    ...page,
  };
}

async function seedWorld(db: Database): Promise<void> {
  await seedPerson(db, EDITOR);
  await seedPerson(db, VIEWER);
  await seedGrant(db, grant(20, EDITOR.id, 'editor', '80-89'));
  await seedGrant(db, grant(22, VIEWER.id, 'viewer', '30-39'));
  await seedPage(db, seeded(SEEDED.workshop80, {}));
  await seedPage(db, seeded(SEEDED.workshop30, { jdArea: '30-39' }));
  await seedPage(
    db,
    seeded(SEEDED.lesson80, {
      type: 'learning',
      status: 'active',
      frontmatter: learningFrontmatter,
    }),
  );
  await seedPage(
    db,
    seeded(SEEDED.persona80, {
      type: 'persona',
      status: 'active',
      frontmatter: personaFrontmatter,
    }),
  );
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedWorld(db);
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return {
    db,
    fixture: await createAccessFixture(),
    connectionString: database.connectionString,
    drop,
  };
}

function rig(): Promise<Rig> {
  rigged ??= openRig();
  return rigged;
}

afterAll(async () => {
  if (rigged !== null) await (await rigged).drop();
});

type Reply = { readonly text: string; readonly body: Body };
type Tool = (name: string, args: Body) => Promise<Reply>;

async function runner(r: Rig, email: string): Promise<Tool> {
  const token = await r.fixture.sign({ email });
  const client = await httpClient(createApp(postgresDeps(r.db, r.fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
  });
  return async (name, args) => {
    const { body } = await callTool(client, name, args);
    return { text: JSON.stringify(body), body };
  };
}

function bodyOf(text: string): Body {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

async function deviceOf(db: Database, person: { id: string; email: string }): Promise<Principal> {
  const human = await personOn(db, person.id, person.email, new Date());
  return principalSchema.parse({
    ...human,
    identity: `agent:${person.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

async function viewer(r: Rig): Promise<Tool> {
  const principal = await deviceOf(r.db, VIEWER);
  const logger = createLogger(
    { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
    () => undefined,
  );
  const clock = { now: () => new Date() };
  return async (name, args) => {
    const context = {
      principal,
      host: 'external' as const,
      at: new Date(),
      traceId: crypto.randomUUID(),
      kernel: kernelOn(r.db, clock),
      db: r.db,
      commit: 'test-commit',
      logger,
    };
    const [block] = (await callVerb(context, name, args, verbHandlers)).content;
    const text = block?.type === 'text' ? block.text : '{}';
    return { text, body: bodyOf(text) };
  };
}

function idsOf(body: Body): unknown[] {
  const found = body['pages'];
  return Array.isArray(found) ? found.map((page: Body) => page['id']).sort() : [];
}

function search(tool: Tool, query: string, type: string | null = null) {
  return tool('search_pages', { query, type, limit: 10 });
}

function newPage(slug: string, overrides: Body = {}): Body {
  return {
    pageId: crypto.randomUUID(),
    type: 'product',
    jdArea: '80-89',
    slug,
    title: 'An agent page',
    parentId: null,
    frontmatter: productFrontmatter,
    bodyMd: 'Written by an agent.',
    expectedVersion: null,
    ...overrides,
  };
}

function write(tool: Tool, page: Body) {
  return tool('write_page', page);
}

async function storedPage(r: Rig, pageId: string) {
  const [row] = await r.db.$client`
    SELECT status, version, (SELECT count(*)::int FROM page_versions WHERE page_id = ${pageId}) AS versions
    FROM pages WHERE id = ${pageId}`;
  return row;
}

async function editSources(r: Rig, pageId: string): Promise<unknown[]> {
  const rows = await r.db.$client`
    SELECT edit_source FROM page_versions WHERE page_id = ${pageId} ORDER BY version`;
  return rows.map((row) => row['edit_source']);
}

function notFound(pageId: string): Body {
  return { status: 'error', reason: 'page_not_found', detail: { pageId } };
}

describe.skipIf(!testServer)(
  'AB-5 search_pages and read_page return only pages the principal may read',
  () => {
    it('finds only the readable area for the viewer and both areas for the editor', async () => {
      const r = await rig();
      const found = await search(await viewer(r), 'harvest');
      expect(idsOf(found.body)).toEqual([SEEDED.workshop30]);
      const editor = await search(await runner(r, EDITOR.email), 'harvest');
      expect(idsOf(editor.body)).toEqual(Object.values(SEEDED).sort());
    });

    it('narrows the search to one page type', async () => {
      const r = await rig();
      const learning = await search(await runner(r, EDITOR.email), 'harvest', 'learning');
      expect(idsOf(learning.body)).toEqual([SEEDED.lesson80]);
    });

    it('reads a readable page and answers an unreadable one exactly as a missing one', async () => {
      const r = await rig();
      const reader = await viewer(r);
      const readable = await reader('read_page', { pageId: SEEDED.workshop30 });
      expect(readable.body['page']).toMatchObject({ id: SEEDED.workshop30, jdArea: '30-39' });
      const hidden = await reader('read_page', { pageId: SEEDED.workshop80 });
      const missing = await reader('read_page', { pageId: MISSING });
      expect(missing.body).toEqual(notFound(MISSING));
      expect(hidden.text).toBe(missing.text.replace(MISSING, SEEDED.workshop80));
    });
  },
);

describe.skipIf(!testServer)(
  "AB-5 write_page runs the page API's validation and records the agent",
  () => {
    it('creates a draft product page recorded as agent:<person>/laptop', async () => {
      const r = await rig();
      const page = newPage('agent-product');
      const created = await write(await runner(r, EDITOR.email), page);
      expect(created.body).toEqual({ pageId: page['pageId'], version: 1, status: 'draft' });
      expect(await editSources(r, String(page['pageId']))).toEqual([`agent:${EDITOR.id}/laptop`]);
    });

    it('refuses an unknown frontmatter field, a taken slug and a stale version', async () => {
      const r = await rig();
      const editor = await runner(r, EDITOR.email);
      const extra = newPage('agent-extra', {
        frontmatter: { ...productFrontmatter, colour: 'red' },
      });
      expect((await write(editor, extra)).body['reason']).toBe('invalid_frontmatter');
      const taken = newPage(`seeded-${SEEDED.workshop80.slice(-4)}`);
      expect((await write(editor, taken)).body['reason']).toBe('slug_taken');
      const stale = { ...newPage('seeded-1410'), pageId: SEEDED.workshop80, expectedVersion: 4 };
      expect((await write(editor, stale)).body['reason']).toBe('stale_version');
    });

    it('refuses a person who may not write the area, and hides a page they cannot read', async () => {
      const r = await rig();
      const writer = await viewer(r);
      expect((await write(writer, newPage('viewer-product'))).body['reason']).toBe('not_permitted');
      const save = { ...newPage('seeded-1410'), pageId: SEEDED.workshop80, expectedVersion: 1 };
      const hidden = await write(writer, save);
      const missing = await write(writer, { ...save, pageId: MISSING });
      expect(missing.body).toEqual(notFound(MISSING));
      expect(hidden.text).toBe(missing.text.replace(MISSING, SEEDED.workshop80));
      const inArea = await write(writer, { ...newPage('viewer-30'), jdArea: '30-39' });
      expect(inArea.body['reason']).toBe('not_permitted');
    });
  },
);

async function suggestThenActivate(r: Rig, editor: Tool): Promise<Body> {
  const page = newPage('agent-learning', { type: 'learning', frontmatter: learningFrontmatter });
  expect((await write(editor, page)).body).toMatchObject({ version: 1, status: 'suggested' });
  const saved = await write(editor, { ...page, bodyMd: 'Saved again.', expectedVersion: 1 });
  expect(saved.body).toMatchObject({ version: 2, status: 'suggested' });
  const person = await personOn(r.db, EDITOR.id, EDITOR.email, new Date());
  const activated = await updatePage(
    r.db,
    person,
    {
      command: 'update_page',
      requestId: crypto.randomUUID(),
      pageId: String(page['pageId']),
      expectedVersion: 2,
      slug: 'agent-learning',
      title: 'An agent page',
      parentId: null,
      frontmatter: learningFrontmatter,
      bodyMd: 'Saved again.',
      status: 'active',
    },
    crypto.randomUUID(),
    new Date(),
  );
  expect(activated.ok).toBe(true);
  return { ...page, expectedVersion: 3 };
}

const gatedRefusal = { status: 'error', reason: 'not_permitted', detail: { why: 'gated_page' } };

describe.skipIf(!testServer)(
  'AB-5 a gated page lands as suggested and is never edited by an agent',
  () => {
    it('suggests a learning, saves it while suggested, and refuses it once a person activates it', async () => {
      const r = await rig();
      const editor = await runner(r, EDITOR.email);
      const page = await suggestThenActivate(r, editor);
      expect((await write(editor, page)).body).toEqual(gatedRefusal);
      expect(await storedPage(r, String(page['pageId']))).toEqual({
        status: 'active',
        version: 3,
        versions: 3,
      });
    });

    it('refuses a save over an active persona page and leaves it unchanged', async () => {
      const r = await rig();
      const save = newPage('seeded-1413', {
        pageId: SEEDED.persona80,
        type: 'persona',
        frontmatter: personaFrontmatter,
        expectedVersion: 1,
      });
      expect((await write(await runner(r, EDITOR.email), save)).body).toEqual(gatedRefusal);
      expect(await storedPage(r, SEEDED.persona80)).toEqual({
        status: 'active',
        version: 1,
        versions: 0,
      });
    });

    it('refuses policy, which is not a registered page type, and a save that changes type or area', async () => {
      const r = await rig();
      const editor = await runner(r, EDITOR.email);
      expect(
        (await write(editor, newPage('agent-policy', { type: 'policy' }))).body['reason'],
      ).toBe('malformed_command');
      const moved = {
        ...newPage('seeded-1410'),
        pageId: SEEDED.workshop80,
        expectedVersion: 1,
        type: 'skill',
      };
      expect((await write(editor, moved)).body['reason']).toBe('malformed_command');
    });
  },
);

async function seedSuggested(db: Database): Promise<string> {
  const pageId = crypto.randomUUID();
  await seedPage(
    db,
    seeded(pageId, {
      type: 'learning',
      status: 'suggested',
      frontmatter: learningFrontmatter,
      slug: 'racing-learning',
      bodyMd: 'The racing notes.',
    }),
  );
  return pageId;
}

function activation(db: Database, person: Principal, pageId: string) {
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    expectedVersion: 1,
    slug: 'racing-learning',
    title: 'A seeded page',
    parentId: null,
    frontmatter: learningFrontmatter,
    bodyMd: 'The racing notes.',
    status: 'active' as const,
  };
  return updatePage(db, person, command, crypto.randomUUID(), new Date());
}

function agentSave(db: Database, agent: Principal, pageId: string) {
  const input = {
    pageId,
    type: 'learning' as const,
    jdArea: '80-89',
    slug: 'racing-learning',
    title: 'Overwritten by an agent',
    parentId: null,
    frontmatter: learningFrontmatter,
    bodyMd: 'The agent was here.',
    expectedVersion: 1,
  };
  return writePageAsAgent(db, agent, input, crypto.randomUUID(), new Date());
}

type Connections = {
  readonly person: Database;
  readonly agent: Database;
  readonly holder: Database;
};

async function raceBehindARowLock(r: Rig, c: Connections, pageId: string) {
  const person = await personOn(c.person, EDITOR.id, EDITOR.email, new Date());
  const agent = await deviceOf(c.agent, EDITOR);
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  let locked = (): void => undefined;
  const rowLocked = new Promise<void>((resolve) => void (locked = resolve));
  const holding = c.holder.$client.begin(async (sql) => {
    await sql`SELECT id FROM pages WHERE id = ${pageId} FOR UPDATE`;
    locked();
    await released;
  });
  await rowLocked;
  try {
    const activated = activation(c.person, person, pageId);
    await awaitBlocked(async () => ((await lockWaiters(r.db)) >= 1 ? 1 : 0));
    const saved = agentSave(c.agent, agent, pageId);
    await awaitBlocked(async () => ((await lockWaiters(r.db)) >= 2 ? 1 : 0));
    release();
    return { activated: await activated, saved: await saved };
  } finally {
    release();
    await holding;
  }
}

async function withConnections(r: Rig, work: (c: Connections) => Promise<void>): Promise<void> {
  const c = {
    person: createClient(r.connectionString),
    agent: createClient(r.connectionString),
    holder: createClient(r.connectionString),
  };
  try {
    await work(c);
  } finally {
    await Promise.all(Object.values(c).map((db) => db.$client.end()));
  }
}

describe.skipIf(!testServer)(
  "AB-5 an agent's save racing a person's activation never undoes it",
  () => {
    it('keeps the activation when the agent saves the version the person just replaced', async () => {
      const r = await rig();
      const pageId = await seedSuggested(r.db);
      await withConnections(r, async (c) => {
        const { activated, saved } = await raceBehindARowLock(r, c, pageId);
        expect(activated.ok).toBe(true);
        expect(saved).toMatchObject({ ok: false, reason: 'stale_version' });
      });
      expect(await storedPage(r, pageId)).toEqual({ status: 'active', version: 2, versions: 1 });
    });
  },
);

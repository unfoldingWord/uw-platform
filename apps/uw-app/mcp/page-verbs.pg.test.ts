import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson, type SeedPage } from '@uw/db/test-seed';
import { software } from '@uw/harness';
import { createApp } from '../app.tsx';
import { updatePage } from '../pages/store.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
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
const IAN = { id: '00000000-0000-4000-8000-000000000001', email: 'ian.lindsley@unfoldingword.org' };
const clock = { now: () => new Date() };

type Body = Record<string, unknown>;
type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly drop: () => Promise<void>;
};

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
    drop,
  };
}

function freshRig(): () => Rig {
  let current: Rig | null = null;
  beforeAll(async () => {
    current = await openRig();
  });
  afterAll(async () => {
    await current?.drop();
  });
  return () => {
    if (current === null) throw new Error('the rig is not open');
    return current;
  };
}

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
    const rig = freshRig();
    it('finds only the readable area for the viewer and both areas for the editor', async () => {
      const r = rig();
      const found = await search(await viewer(r), 'harvest');
      expect(idsOf(found.body)).toEqual([SEEDED.workshop30]);
      const editor = await search(await runner(r, EDITOR.email), 'harvest');
      expect(idsOf(editor.body)).toEqual(Object.values(SEEDED).sort());
    });

    it('narrows the search to one page type', async () => {
      const r = rig();
      const learning = await search(await runner(r, EDITOR.email), 'harvest', 'learning');
      expect(idsOf(learning.body)).toEqual([SEEDED.lesson80]);
    });

    it('reads a readable page and answers an unreadable one exactly as a missing one', async () => {
      const r = rig();
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
    const rig = freshRig();

    it('creates a new product page as a draft', async () => {
      const page = newPage('agent-product');
      const created = await write(await runner(rig(), EDITOR.email), page);
      expect(created.body).toEqual({ pageId: page['pageId'], version: 1, status: 'draft' });
    });

    it('refuses an unknown frontmatter field, a taken slug and a stale version', async () => {
      const r = rig();
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
      const r = rig();
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
    const rig = freshRig();
    it('suggests a learning, saves it while suggested, and refuses it once a person activates it', async () => {
      const r = rig();
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
      const r = rig();
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
      const r = rig();
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

describe.skipIf(!testServer)('AB-3 page version history records the agent identity', () => {
  const rig = freshRig();

  it('records a page the agent creates as agent:<person>/laptop', async () => {
    const r = rig();
    const page = newPage('agent-history');
    expect((await write(await runner(r, EDITOR.email), page)).body['status']).toBe('draft');
    expect(await editSources(r, String(page['pageId']))).toEqual([`agent:${EDITOR.id}/laptop`]);
  });
});

async function nameAsInstructions(r: Rig, stageKey: string, pageId: string): Promise<void> {
  const ian = await personOn(r.db, IAN.id, IAN.email, new Date());
  const kernel = kernelOn(r.db, clock);
  const caller = { actor: ian, traceId: crypto.randomUUID() };
  const harnessId = crypto.randomUUID();
  const harnessKey = `software-${stageKey}`;
  const activation = { harnessId, harnessKey, jdArea: '80-89', template: software };
  expect((await kernel.stages.activate(caller, activation)).status).toBe('accepted');
  const change = { instructionsPageId: pageId };
  const edited = await kernel.stages.updateStage(caller, { harnessId, stageKey, change });
  expect(edited.status).toBe('accepted');
}

function personSave(r: Rig, page: Body) {
  return personOn(r.db, EDITOR.id, EDITOR.email, new Date()).then((person) =>
    updatePage(
      r.db,
      person,
      {
        command: 'update_page',
        requestId: crypto.randomUUID(),
        pageId: String(page['pageId']),
        expectedVersion: 1,
        slug: String(page['slug']),
        title: 'Edited by a person',
        parentId: null,
        frontmatter: productFrontmatter,
        bodyMd: 'A person edits the instructions.',
        status: 'active',
      },
      crypto.randomUUID(),
      new Date(),
    ),
  );
}

const instructionsRefusal = {
  status: 'error',
  reason: 'not_permitted',
  detail: { why: 'stage_instructions' },
};

describe.skipIf(!testServer)(
  'an agent never saves a page a stage names as its instructions',
  () => {
    const rig = freshRig();

    it('refuses the agent on an active product page and accepts a person', async () => {
      const r = rig();
      const pageId = crypto.randomUUID();
      await seedPage(r.db, seeded(pageId, { status: 'active', slug: 'stage-instructions' }));
      await nameAsInstructions(r, 'package', pageId);
      const save = newPage('stage-instructions', { pageId, expectedVersion: 1 });
      expect((await write(await runner(r, EDITOR.email), save)).body).toEqual(instructionsRefusal);
      expect(await storedPage(r, pageId)).toEqual({ status: 'active', version: 1, versions: 0 });
      expect((await personSave(r, save)).ok).toBe(true);
    });

    it('refuses the agent on a suggested learning page too', async () => {
      const r = rig();
      const pageId = crypto.randomUUID();
      const learning = { type: 'learning' as const, status: 'suggested' as const };
      await seedPage(
        r.db,
        seeded(pageId, { ...learning, frontmatter: learningFrontmatter, slug: 'stage-learning' }),
      );
      await nameAsInstructions(r, 'check', pageId);
      const save = newPage('stage-learning', {
        pageId,
        type: 'learning',
        frontmatter: learningFrontmatter,
        expectedVersion: 1,
      });
      expect((await write(await runner(r, EDITOR.email), save)).body).toEqual(instructionsRefusal);
    });
  },
);

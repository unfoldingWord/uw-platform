import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson, type SeedPage } from '@uw/db/test-seed';
import { DEFAULT_SPEND_CAP, software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { createTask } from '../tasks/store.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN = { id: '00000000-0000-4000-8000-000000000001', email: 'ian.lindsley@unfoldingword.org' };
const EDITOR = {
  id: '00000000-0000-4000-8000-000000001501',
  email: 'context-editor@unfoldingword.org',
};
const VIEWER_80 = {
  id: '00000000-0000-4000-8000-000000001502',
  email: 'context-viewer-80@unfoldingword.org',
};
const VIEWER_30 = {
  id: '00000000-0000-4000-8000-000000001503',
  email: 'context-viewer-30@unfoldingword.org',
};
const PAGE = {
  item: '00000000-0000-4000-8000-000000001510',
  strategy: '00000000-0000-4000-8000-000000001511',
  itemLearning: '00000000-0000-4000-8000-000000001512',
  instructions: '00000000-0000-4000-8000-000000001513',
  instructionsLearning: '00000000-0000-4000-8000-000000001514',
  areaLearning: '00000000-0000-4000-8000-000000001515',
  suggestedLearning: '00000000-0000-4000-8000-000000001516',
  otherAreaLearning: '00000000-0000-4000-8000-000000001517',
  skill: '00000000-0000-4000-8000-000000001518',
  retired: '00000000-0000-4000-8000-000000001519',
  broken: '00000000-0000-4000-8000-000000001520',
};
const GRANTED_AT = new Date('2026-01-01T00:00:00.000Z');
const clock = { now: () => new Date() };

type Body = Record<string, unknown>;
type Tool = (name: string, args: Body) => Promise<Body>;
type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly harnessId: string;
  readonly itemIds: readonly string[];
  readonly packageItems: { readonly bare: string; readonly paged: string };
  readonly drop: () => Promise<void>;
};

function grant(n: number, personId: string, role: 'editor' | 'viewer', area: string) {
  return {
    id: `00000000-0000-4000-8000-0000000015${String(n).padStart(2, '0')}`,
    personId,
    role,
    scopeKind: 'jd_area' as const,
    scopeArea: area,
    grantedAt: GRANTED_AT,
    expiresAt: null,
  };
}

function learning(asOf: string, confidence: string) {
  return { confidence, as_of: asOf, supersedes: [], review_by: null };
}

function page(id: string, overrides: Partial<SeedPage>): SeedPage {
  return {
    id,
    type: 'product',
    status: 'active',
    jdArea: '80-89',
    slug: `context-${id.slice(-4)}`,
    title: `Page ${id.slice(-4)}`,
    bodyMd: 'Context.',
    frontmatter: { owner: `human:${EDITOR.id}`, summary: 'A product.' },
    ...overrides,
  };
}

const scopeSkill = { name: 'scope', description: 'How to scope an item.' };
const strategyFrontmatter = { niche: 'Translators', hypothesis: 'They need help.' };

const seededPages: readonly SeedPage[] = [
  page(PAGE.item, {}),
  page(PAGE.instructions, { type: 'skill', frontmatter: scopeSkill }),
  page(PAGE.strategy, {
    type: 'product_strategy',
    parentId: PAGE.item,
    frontmatter: strategyFrontmatter,
  }),
  page(PAGE.itemLearning, {
    type: 'learning',
    parentId: PAGE.item,
    frontmatter: learning('2026-09-01', 'observed'),
  }),
  page(PAGE.instructionsLearning, {
    type: 'learning',
    parentId: PAGE.instructions,
    frontmatter: learning('2026-09-20', 'confirmed'),
  }),
  page(PAGE.areaLearning, { type: 'learning', frontmatter: learning('2026-09-30', 'inferred') }),
  page(PAGE.otherAreaLearning, {
    type: 'learning',
    jdArea: '30-39',
    parentId: PAGE.item,
    frontmatter: learning('2026-09-10', 'observed'),
  }),
  page(PAGE.skill, {
    type: 'skill',
    parentId: PAGE.item,
    frontmatter: { name: 'run-workshop', description: 'How to run a workshop.' },
  }),
  page(PAGE.retired, {
    type: 'product_strategy',
    status: 'retired',
    parentId: PAGE.item,
    frontmatter: strategyFrontmatter,
  }),
  page(PAGE.suggestedLearning, {
    type: 'learning',
    status: 'suggested',
    frontmatter: learning('2026-10-01', 'assumed'),
  }),
];

async function seedWorld(db: Database): Promise<void> {
  await seedPerson(db, EDITOR);
  await seedPerson(db, VIEWER_80);
  await seedPerson(db, VIEWER_30);
  await seedGrant(db, grant(20, EDITOR.id, 'editor', '80-89'));
  await seedGrant(db, grant(21, VIEWER_80.id, 'viewer', '80-89'));
  await seedGrant(db, grant(22, VIEWER_30.id, 'viewer', '30-39'));
  for (const seeded of seededPages) await seedPage(db, seeded);
}

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function itemInScope(kernel: Kernel, ian: Principal, harnessId: string, n: number) {
  const input = { harnessId, title: `Item ${n}`, pageId: PAGE.item, priority: n, due: null };
  const { itemId } = value(
    await kernel.items.enqueue(caller(ian), { ...input, delegationId: null }),
  );
  value(await kernel.items.claim(caller(ian), { itemId, delegationId: null }));
  const submit = { itemId, to: null, evidence: {}, change: null };
  value(await kernel.items.submit(caller(ian), submit));
  return itemId;
}

async function itemInPackage(
  kernel: Kernel,
  ian: Principal,
  harnessId: string,
  pageId: string | null,
  priority = 0,
) {
  const input = { harnessId, title: 'Package item', pageId, priority, due: null };
  return value(await kernel.items.enqueue(caller(ian), { ...input, delegationId: null })).itemId;
}

function activationOf(harnessId: string, harnessKey: string) {
  const repository = harnessKey === 'software' ? 'unfoldingWord/uw-platform' : null;
  return { harnessId, harnessKey, jdArea: '80-89', template: software, repository };
}

async function seedHarness(kernel: Kernel, ian: Principal) {
  const harnessId = crypto.randomUUID();
  value(await kernel.stages.activate(caller(ian), activationOf(harnessId, 'software')));
  const change = { instructionsPageId: PAGE.instructions };
  value(await kernel.stages.updateStage(caller(ian), { harnessId, stageKey: 'scope', change }));
  const itemIds = [
    await itemInScope(kernel, ian, harnessId, 1),
    await itemInScope(kernel, ian, harnessId, 2),
  ];
  const packageItems = {
    bare: await itemInPackage(kernel, ian, harnessId, null),
    paged: await itemInPackage(kernel, ian, harnessId, PAGE.item),
  };
  return { harnessId, itemIds, packageItems };
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedWorld(db);
  const kernel = kernelOn(db, clock);
  const ian = await personOn(db, IAN.id, IAN.email, new Date());
  const scene = await seedHarness(kernel, ian);
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return { db, fixture: await createAccessFixture(), kernel, ian, ...scene, drop };
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

async function runner(r: Rig, email: string): Promise<Tool> {
  const token = await r.fixture.signForMcp({ email });
  const client = await httpClient(createApp(postgresDeps(r.db, r.fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
  });
  return async (name, args) => (await callTool(client, name, args)).body;
}

function bodyOf(text: string): Body {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

async function viewer(
  r: Rig,
  person: { id: string; email: string },
  lines: string[] = [],
): Promise<Tool> {
  const human = await personOn(r.db, person.id, person.email, new Date());
  const principal = principalSchema.parse({
    ...human,
    identity: `agent:${person.id}/laptop`,
    kind: 'agent',
    email: null,
  });
  const logger = createLogger(
    { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
    (line) => lines.push(line),
  );
  return async (name, args) => {
    const context = {
      principal,
      host: 'external' as const,
      at: new Date(),
      traceId: crypto.randomUUID(),
      kernel: r.kernel,
      db: r.db,
      commit: 'test-commit',
      cap: DEFAULT_SPEND_CAP,
      logger,
    };
    const [block] = (await callVerb(context, name, args, verbHandlers)).content;
    return bodyOf(block?.type === 'text' ? block.text : '{}');
  };
}

function summary(id: string, type = 'product', jdArea = '80-89'): Body {
  return {
    id,
    type,
    jdArea,
    slug: `context-${id.slice(-4)}`,
    title: `Page ${id.slice(-4)}`,
    status: 'active',
  };
}

const itemLearning = {
  page: summary(PAGE.itemLearning, 'learning'),
  confidence: 'observed',
  asOf: '2026-09-01',
};
const laterTiers = [
  {
    page: summary(PAGE.instructionsLearning, 'learning'),
    confidence: 'confirmed',
    asOf: '2026-09-20',
  },
  { page: summary(PAGE.areaLearning, 'learning'), confidence: 'inferred', asOf: '2026-09-30' },
];

describe.skipIf(!testServer)(
  'AB-5 resolve_context returns instructions, package and confirmed learnings, most specific first',
  () => {
    const rig = freshRig();

    it('answers the stage instructions, the package and the tiers of active learnings', async () => {
      const r = rig();
      const [itemId] = r.itemIds;
      const reader = await viewer(r, VIEWER_80);
      expect(await reader('resolve_context', { itemId })).toEqual({
        instructions: summary(PAGE.instructions, 'skill'),
        package: [summary(PAGE.item), summary(PAGE.strategy, 'product_strategy')],
        learnings: [itemLearning, ...laterTiers],
      });
    });

    it('adds a learning in another area only for a caller who may read it', async () => {
      const r = rig();
      const [itemId] = r.itemIds;
      const context = await (await runner(r, EDITOR.email))('resolve_context', { itemId });
      const otherArea = {
        page: summary(PAGE.otherAreaLearning, 'learning', '30-39'),
        confidence: 'observed',
        asOf: '2026-09-10',
      };
      expect(context['learnings']).toEqual([otherArea, itemLearning, ...laterTiers]);
    });

    it('answers a viewer of another area exactly as a missing item', async () => {
      const r = rig();
      const [itemId] = r.itemIds;
      const outsider = await viewer(r, VIEWER_30);
      expect(await outsider('resolve_context', { itemId })).toEqual({
        status: 'error',
        reason: 'item_not_found',
        detail: { itemId },
      });
    });
  },
);

const areaOnly = [laterTiers[1], laterTiers[0], itemLearning];

async function seedBulkLearnings(r: Rig, count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) {
    const day = String(n).padStart(2, '0');
    const id = crypto.randomUUID();
    const frontmatter = learning(`2026-08-${day}`, 'observed');
    await seedPage(r.db, page(id, { type: 'learning', slug: `bulk-${day}`, frontmatter }));
  }
}

function asOfs(body: Body): unknown[] {
  const learnings = Array.isArray(body['learnings']) ? body['learnings'] : [];
  return learnings.map((entry: Body) => entry['asOf']);
}

describe.skipIf(!testServer)(
  'AB-5 resolve_context orders learnings by as_of within a tier and answers at most 20',
  () => {
    const rig = freshRig();

    it('answers only area learnings, newest first, for an item with no page or instructions', async () => {
      const r = rig();
      const reader = await viewer(r, VIEWER_80);
      expect(await reader('resolve_context', { itemId: r.packageItems.bare })).toEqual({
        instructions: null,
        package: [],
        learnings: areaOnly,
      });
    });

    it('puts the item page tier first and leaves out a retired package page', async () => {
      const r = rig();
      const reader = await viewer(r, VIEWER_80);
      expect(await reader('resolve_context', { itemId: r.packageItems.paged })).toEqual({
        instructions: null,
        package: [summary(PAGE.item), summary(PAGE.strategy, 'product_strategy')],
        learnings: [itemLearning, laterTiers[1], laterTiers[0]],
      });
    });

    it('drops and logs a learning whose frontmatter does not parse', async () => {
      const r = rig();
      const frontmatter = learning('2026-02-30', 'observed');
      await seedPage(r.db, page(PAGE.broken, { type: 'learning', frontmatter }));
      const lines: string[] = [];
      const reader = await viewer(r, VIEWER_80, lines);
      const context = await reader('resolve_context', { itemId: r.packageItems.bare });
      expect(context['learnings']).toEqual(areaOnly);
      expect(lines.filter((line) => line.includes(PAGE.broken))).toHaveLength(1);
    });

    it('answers at most 20 learnings', async () => {
      const r = rig();
      await seedBulkLearnings(r, 20);
      const reader = await viewer(r, VIEWER_80);
      const found = asOfs(await reader('resolve_context', { itemId: r.packageItems.bare }));
      expect(found).toHaveLength(20);
      expect(found.slice(0, 4)).toEqual(['2026-09-30', '2026-09-20', '2026-09-01', '2026-08-20']);
      expect(found.at(-1)).toBe('2026-08-04');
    });
  },
);

describe.skipIf(!testServer)('AB-5 resolve_context fills 20 learnings past invalid ones', () => {
  const rig = freshRig();
  it('leaves out learnings without confidence or as_of before taking 20', async () => {
    const r = rig();
    await seedBulkLearnings(r, 20);
    for (const [n, frontmatter] of [
      { as_of: '2026-12-01' },
      { confidence: 'observed' },
    ].entries()) {
      const slug = `invalid-${n}`;
      await seedPage(r.db, page(crypto.randomUUID(), { type: 'learning', slug, frontmatter }));
    }
    const found = asOfs(
      await (
        await viewer(r, VIEWER_80)
      )('resolve_context', { itemId: r.packageItems.bare }),
    );
    expect([found.length, found[0], found.at(-1)]).toEqual([20, '2026-09-30', '2026-08-04']);
  });
});

async function seedTasks(r: Rig): Promise<readonly Body[]> {
  const tasks: Body[] = [];
  for (const [n, title] of ['Plan the workshop', 'Book the venue'].entries()) {
    const task = {
      taskId: crypto.randomUUID(),
      jdArea: '30-39' as const,
      title,
      pageId: null,
      due: null,
    };
    const at = new Date(Date.UTC(2026, 9, 1, 9, n));
    const created = await createTask(r.db, r.ian, task, crypto.randomUUID(), at);
    expect(created.ok).toBe(true);
    tasks.push({ ...task, status: 'suggested' });
  }
  return tasks;
}

function malformed(detail: Body): Body {
  return { status: 'error', reason: 'malformed_command', detail };
}

describe.skipIf(!testServer)(
  'AB-5 query_entities runs only whitelisted queries and returns only readable rows',
  () => {
    const rig = freshRig();

    it('answers open tasks only to a caller who may read the area', async () => {
      const r = rig();
      const tasks = await seedTasks(r);
      const query = { query: 'open_tasks', params: { jdArea: '30-39' } };
      expect(await (await viewer(r, VIEWER_80))('query_entities', query)).toEqual({ rows: [] });
      const rows = await (await runner(r, EDITOR.email))('query_entities', query);
      expect(rows).toEqual({ rows: tasks });
    });

    it('answers the items of a readable stage and hides an unreadable harness', async () => {
      const r = rig();
      const query = { query: 'stage_items', params: { harnessId: r.harnessId, stageKey: 'scope' } };
      const found = await (await runner(r, EDITOR.email))('query_entities', query);
      const rows = Array.isArray(found['rows']) ? found['rows'] : [];
      expect(rows.map((row: Body) => row['itemId'])).toEqual([...r.itemIds].reverse());
      expect(rows.every((row: Body) => row['stageKey'] === 'scope')).toBe(true);
      expect(await (await viewer(r, VIEWER_30))('query_entities', query)).toEqual({
        status: 'error',
        reason: 'harness_not_found',
        detail: { harnessId: r.harnessId },
      });
    });

    it('answers at most 50 items of a stage, highest priority first', async () => {
      const r = rig();
      const harnessId = crypto.randomUUID();
      value(await r.kernel.stages.activate(caller(r.ian), activationOf(harnessId, 'many')));
      for (let n = 0; n < 51; n += 1) await itemInPackage(r.kernel, r.ian, harnessId, null, n);
      const query = { query: 'stage_items', params: { harnessId, stageKey: 'package' } };
      const found = await (await runner(r, EDITOR.email))('query_entities', query);
      const rows = Array.isArray(found['rows']) ? found['rows'] : [];
      expect(rows).toHaveLength(50);
      expect(rows.map((row: Body) => row['priority'])).not.toContain(0);
    });

    it('refuses a query outside the whitelist and parameters that do not parse', async () => {
      const tool = await runner(rig(), EDITOR.email);
      for (const query of ['drop_tables', 'measurements', 'constructor']) {
        const refused = await tool('query_entities', { query, params: {} });
        expect(refused).toEqual(malformed({ why: 'unknown_query' }));
      }
      const badArea = await tool('query_entities', {
        query: 'open_tasks',
        params: { jdArea: '8-89' },
      });
      expect(badArea['reason']).toBe('malformed_command');
      const injected = { query: "open_tasks'; DROP TABLE tasks; --", params: {} };
      expect((await tool('query_entities', injected))['reason']).toBe('malformed_command');
    });
  },
);

async function createdBy(r: Rig, taskId: unknown): Promise<unknown> {
  const rows = await r.db
    .$client`SELECT created_by, status FROM tasks WHERE id = ${String(taskId)}`;
  return rows[0];
}

describe.skipIf(!testServer)('AB-5 create_task suggests a task attributed to the agent', () => {
  const rig = freshRig();
  const task = { title: 'Write up the workshop', pageId: null, due: '2026-10-09' };

  it('creates a suggested task whose creator is the agent identity', async () => {
    const r = rig();
    const created = await (
      await runner(r, EDITOR.email)
    )('create_task', { ...task, jdArea: '80-89' });
    expect(created).toEqual({ taskId: expect.any(String), status: 'suggested' });
    expect(await createdBy(r, created['taskId'])).toEqual({
      created_by: `agent:${EDITOR.id}/laptop`,
      status: 'suggested',
    });
  });

  it('names the page only when the linked page is missing', async () => {
    const pageId = '00000000-0000-4000-8000-000000001599';
    const editor = await runner(rig(), EDITOR.email);
    expect(await editor('create_task', { ...task, jdArea: '80-89', pageId })).toEqual({
      status: 'error',
      reason: 'page_not_found',
      detail: { pageId },
    });
  });

  it('refuses an area the agent cannot write, the same whether or not it can read it', async () => {
    const r = rig();
    const refused = { status: 'error', reason: 'not_permitted', detail: {} };
    const editor = await runner(r, EDITOR.email);
    expect(await editor('create_task', { ...task, jdArea: '30-39' })).toEqual(refused);
    const reader = await viewer(r, VIEWER_30);
    expect(await reader('create_task', { ...task, jdArea: '30-39' })).toEqual(refused);
    expect(await reader('create_task', { ...task, jdArea: '80-89' })).toEqual(refused);
  });
});

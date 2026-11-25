import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '@uw/db/test-database';
import { seedPage } from '@uw/db/test-seed';
import { createTask } from '../tasks/store.ts';
import {
  ROWAN,
  EDITOR,
  VIEWER_80,
  VIEWER_30,
  PAGE,
  type Body,
  type Tool,
  type Rig,
  learning,
  page,
  caller,
  value,
  itemInPackage,
  activationOf,
  openRig,
  runner,
  viewer,
  summary,
  itemLearning,
  laterTiers,
} from '../testing/context-rig.ts';

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

describe.skipIf(!testServer)(
  'AB-5 resolve_context returns instructions, package and confirmed learnings, most specific first',
  () => {
    const rig = freshRig();

    it('answers the stage instructions, the package and the tiers of active learnings', async () => {
      const r = rig();
      const [itemId] = r.itemIds;
      const reader = await viewer(r, VIEWER_80);
      expect(await reader('resolve_context', { itemId })).toEqual({
        instructions: { ...summary(PAGE.instructions, 'skill'), bodyMd: 'Context.' },
        package: [summary(PAGE.item), summary(PAGE.strategy, 'product_strategy')],
        learnings: [itemLearning, ...laterTiers],
        policies: [],
        decisions: [],
      });
    });

    it('adds a learning in another area only for a caller who may read it', async () => {
      const r = rig();
      const [itemId] = r.itemIds;
      const otherArea = {
        page: summary(PAGE.otherAreaLearning, 'learning', '30-39'),
        confidence: 'observed',
        asOf: '2026-09-10',
      };
      const seen = async (tool: Tool) => (await tool('resolve_context', { itemId }))['learnings'];
      expect(await seen(await runner(r, EDITOR.email))).toEqual([itemLearning, ...laterTiers]);
      expect(await seen(await viewer(r, ROWAN))).toEqual([otherArea, itemLearning, ...laterTiers]);
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
        policies: [],
        decisions: [],
      });
    });

    it('puts the item page tier first and leaves out a retired package page', async () => {
      const r = rig();
      const reader = await viewer(r, VIEWER_80);
      expect(await reader('resolve_context', { itemId: r.packageItems.paged })).toEqual({
        instructions: null,
        package: [summary(PAGE.item), summary(PAGE.strategy, 'product_strategy')],
        learnings: [itemLearning, laterTiers[1], laterTiers[0]],
        policies: [],
        decisions: [],
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
    const created = await createTask(r.db, r.rowan, task, crypto.randomUUID(), at);
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
      expect(await (await viewer(r, VIEWER_30))('query_entities', query)).toEqual({ rows: tasks });
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
      value(await r.kernel.stages.activate(caller(r.rowan), activationOf(harnessId, 'many')));
      for (let n = 0; n < 51; n += 1) await itemInPackage(r.kernel, r.rowan, harnessId, null, n);
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

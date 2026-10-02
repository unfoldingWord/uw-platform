import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { software, type Caller, type Kernel } from '@uw/harness';
import { createTask } from '../tasks/store.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN = { id: '00000000-0000-4000-8000-000000000001', email: 'ian.lindsley@unfoldingword.org' };
const VIEWER_80 = {
  id: '00000000-0000-4000-8000-000000002701',
  email: 'rows-viewer@unfoldingword.org',
};
const ORG_VIEWER = {
  id: '00000000-0000-4000-8000-000000002702',
  email: 'rows-org@unfoldingword.org',
};
const ORG_EDITOR = {
  id: '00000000-0000-4000-8000-000000002703',
  email: 'rows-edit@unfoldingword.org',
};
const AREAS = ['80-89', '30-39'] as const;
const GRANTED_AT = new Date('2026-01-01T00:00:00.000Z');
const clock = { now: () => new Date() };

type Area = (typeof AREAS)[number];
type Body = Record<string, unknown>;
type Tool = (name: string, args: Body) => Promise<Body>;
type Rig = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly harnesses: Readonly<Record<Area, string>>;
  readonly items: Readonly<Record<Area, string>>;
  readonly drop: () => Promise<void>;
};

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

async function seedPeople(db: Database): Promise<void> {
  const people = [
    { person: VIEWER_80, role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
    { person: ORG_VIEWER, role: 'viewer', scopeKind: 'org', scopeArea: null },
    { person: ORG_EDITOR, role: 'editor', scopeKind: 'org', scopeArea: null },
  ] as const;
  for (const [n, { person, ...grant }] of people.entries()) {
    await seedPerson(db, person);
    const id = `00000000-0000-4000-8000-0000000027${String(n + 10)}`;
    await seedGrant(db, {
      id,
      personId: person.id,
      ...grant,
      grantedAt: GRANTED_AT,
      expiresAt: null,
    });
  }
}

async function seedPagesAndTasks(db: Database, ian: Principal): Promise<void> {
  for (const [n, area] of AREAS.entries()) {
    await seedPage(db, {
      id: `00000000-0000-4000-8000-0000000027${String(n + 20)}`,
      type: 'product',
      status: 'active',
      jdArea: area,
      slug: `lantern-${n}`,
      title: `Lantern ${area}`,
      bodyMd: 'The lantern guide.',
    });
    const task = { taskId: crypto.randomUUID(), jdArea: area, title: `Lantern task ${area}` };
    const created = await createTask(
      db,
      ian,
      { ...task, pageId: null, due: null },
      crypto.randomUUID(),
      new Date(),
    );
    if (!created.ok) throw new Error(`creating a task in ${area} was refused`);
  }
}

async function harnessIn(kernel: Kernel, ian: Principal, area: Area) {
  const harnessId = crypto.randomUUID();
  const activation = { harnessId, harnessKey: `rows-${area}`, jdArea: area, template: software };
  value(await kernel.stages.activate(caller(ian), activation));
  const change = { agentPickup: 'allowed' as const };
  value(await kernel.stages.updateStage(caller(ian), { harnessId, stageKey: 'package', change }));
  const input = { harnessId, title: `Item ${area}`, pageId: null, priority: 1, due: null };
  const { itemId } = value(
    await kernel.items.enqueue(caller(ian), { ...input, delegationId: null }),
  );
  return { harnessId, itemId };
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedPeople(db);
  const kernel = kernelOn(db, clock);
  const ian = await personOn(db, IAN.id, IAN.email, new Date());
  await seedPagesAndTasks(db, ian);
  const first = await harnessIn(kernel, ian, '80-89');
  const second = await harnessIn(kernel, ian, '30-39');
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return {
    db,
    kernel,
    ian,
    harnesses: { '80-89': first.harnessId, '30-39': second.harnessId },
    items: { '80-89': first.itemId, '30-39': second.itemId },
    drop,
  };
}

let current: Rig | null = null;

function rig(): Rig {
  if (current === null) throw new Error('the rig is not open');
  return current;
}

function bodyOf(text: string): Body {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

async function agentOn(r: Rig, person: { id: string; email: string }, kernel = r.kernel) {
  const human = await personOn(r.db, person.id, person.email, new Date());
  const principal = principalSchema.parse({
    ...human,
    identity: `agent:${person.id}/laptop`,
    kind: 'agent',
    email: null,
  });
  const logger = createLogger(
    { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
    () => undefined,
  );
  const tool: Tool = async (name, args) => {
    const context = {
      principal,
      host: 'external' as const,
      at: new Date(),
      traceId: crypto.randomUUID(),
      kernel,
      db: r.db,
      commit: 'test-commit',
      logger,
    };
    const [block] = (await callVerb(context, name, args, verbHandlers)).content;
    return bodyOf(block?.type === 'text' ? block.text : '{}');
  };
  return { principal, tool };
}

function listed(body: Body, key: string, field: string): unknown[] {
  const rows = body[key];
  return Array.isArray(rows) ? rows.map((row: Body) => row[field]) : [];
}

async function searched(tool: Tool): Promise<unknown[]> {
  const body = await tool('search_pages', { query: 'lantern', type: null, limit: 20 });
  return listed(body, 'pages', 'jdArea');
}

async function openTasksIn(tool: Tool, area: Area): Promise<unknown[]> {
  const body = await tool('query_entities', { query: 'open_tasks', params: { jdArea: area } });
  return listed(body, 'rows', 'jdArea');
}

async function stageItemsIn(r: Rig, tool: Tool, area: Area): Promise<unknown[]> {
  const params = { harnessId: r.harnesses[area], stageKey: 'package' };
  return listed(await tool('query_entities', { query: 'stage_items', params }), 'rows', 'itemId');
}

async function polled(tool: Tool): Promise<unknown[]> {
  return listed(await tool('poll_queue', { harnessId: null, limit: 20 }), 'items', 'itemId');
}

async function kernelPollingAs(r: Rig, actor: Principal): Promise<Kernel> {
  const reads = {
    ...r.kernel.reads,
    poll: (_caller: Caller, input: Parameters<Kernel['reads']['poll']>[1]) =>
      r.kernel.reads.poll(caller(actor), input),
  };
  return { ...r.kernel, reads };
}

describe.skipIf(!testServer)(
  'AB-3 a row-filtered verb never answers a row from an area the caller cannot read',
  () => {
    beforeAll(async () => {
      current = await openRig();
    });
    afterAll(async () => {
      await current?.drop();
    });

    it('search_pages answers the page in the readable area and not the other', async () => {
      const r = rig();
      expect((await searched((await agentOn(r, ORG_VIEWER)).tool)).sort()).toEqual([
        '30-39',
        '80-89',
      ]);
      expect(await searched((await agentOn(r, VIEWER_80)).tool)).toEqual(['80-89']);
    });

    it('query_entities open_tasks answers tasks only in the readable area', async () => {
      const r = rig();
      const all = (await agentOn(r, ORG_VIEWER)).tool;
      expect([...(await openTasksIn(all, '80-89')), ...(await openTasksIn(all, '30-39'))]).toEqual([
        '80-89',
        '30-39',
      ]);
      const reader = (await agentOn(r, VIEWER_80)).tool;
      expect(await openTasksIn(reader, '80-89')).toEqual(['80-89']);
      expect(await openTasksIn(reader, '30-39')).toEqual([]);
    });

    it('query_entities stage_items answers items only of the readable harness', async () => {
      const r = rig();
      const all = (await agentOn(r, ORG_VIEWER)).tool;
      expect(await stageItemsIn(r, all, '30-39')).toEqual([r.items['30-39']]);
      const reader = (await agentOn(r, VIEWER_80)).tool;
      expect(await stageItemsIn(r, reader, '80-89')).toEqual([r.items['80-89']]);
      expect(await stageItemsIn(r, reader, '30-39')).toEqual([]);
    });

    it('poll_queue drops the queued item of the unreadable area even when the queue holds both', async () => {
      const r = rig();
      const editor = await agentOn(r, ORG_EDITOR);
      expect((await polled(editor.tool)).sort()).toEqual(
        [r.items['80-89'], r.items['30-39']].sort(),
      );
      const mixed = await kernelPollingAs(r, editor.principal);
      const reader = (await agentOn(r, VIEWER_80, mixed)).tool;
      expect(await polled(reader)).toEqual([r.items['80-89']]);
      expect(await polled((await agentOn(r, VIEWER_80)).tool)).toEqual([]);
    });
  },
);

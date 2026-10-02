import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { agentOf, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { createTask, openTasks } from './store.ts';

const AREA = '80-89';
const OTHER = '30-39';
const at = new Date('2026-10-02T12:00:00.000Z');
const granted = new Date('2026-10-01T00:00:00.000Z');

type Rig = { readonly editor: Principal; readonly viewer: Principal };

async function person(db: Database, n: number, role: 'editor' | 'viewer', areas: string[]) {
  const id = `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`;
  const email = `task${n}@unfoldingword.org`;
  await seedPerson(db, { id, email });
  for (const [index, area] of areas.entries()) {
    await seedGrant(db, {
      id: `00000000-0000-4000-8000-0000000017${n}${index}`,
      personId: id,
      role,
      scopeKind: 'jd_area',
      scopeArea: area,
      grantedAt: granted,
      expiresAt: null,
    });
  }
  return personOn(db, id, email, at);
}

async function withRig(work: (db: Database, rig: Rig) => Promise<void>): Promise<void> {
  return withAppDatabase(async (db) => {
    const editor = await person(db, 1, 'editor', [AREA, OTHER]);
    const viewer = await person(db, 2, 'viewer', [OTHER]);
    await work(db, { editor, viewer });
  });
}

function idsOf(rows: readonly { readonly taskId: string }[]): string[] {
  return rows.map((row) => row.taskId);
}

async function seedTasks(db: Database, editor: Principal) {
  const agent = agentOf(editor, 'laptop');
  const inArea = newTask(AREA);
  const elsewhere = newTask(OTHER);
  await createTask(db, agent, inArea, randomUUID(), at);
  await createTask(db, agent, elsewhere, randomUUID(), at);
  return { inArea: inArea.taskId, elsewhere: elsewhere.taskId };
}

async function seedMany(db: Database, editor: Principal): Promise<string[]> {
  const agent = agentOf(editor, 'laptop');
  const made: { id: string; at: Date }[] = [];
  for (let n = 0; n < 52; n += 1) {
    const task = newTask(AREA);
    const when = new Date(at.getTime() + Math.floor(n / 2) * 1000);
    await createTask(db, agent, task, randomUUID(), when);
    made.push({ id: task.taskId, at: when });
  }
  made.sort((x, y) => x.at.getTime() - y.at.getTime() || (x.id < y.id ? -1 : 1));
  return made.slice(0, 50).map((m) => m.id);
}

async function linkedPage(db: Database): Promise<string> {
  const pageId = randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'skill',
    status: 'draft',
    jdArea: AREA,
    bodyMd: '',
    slug: 'linked',
    title: 'Linked',
  });
  return pageId;
}

function newTask(area: string, overrides: Record<string, unknown> = {}) {
  return {
    taskId: randomUUID(),
    jdArea: area,
    title: 'Follow up',
    pageId: null,
    due: null,
    ...overrides,
  };
}

describe.skipIf(!testServer)(
  'AB-5 create_task records a suggested task attributed to its creator',
  () => {
    it('stores a suggested task for the agent at the given instant', () =>
      withRig(async (db, { editor }) => {
        const agent = agentOf(editor, 'laptop');
        const task = newTask(AREA, { due: '2026-11-01' });
        const result = await createTask(db, agent, task, randomUUID(), at);
        expect(result).toEqual({
          ok: true,
          task: { ...task, status: 'suggested', createdBy: agent.identity },
        });
        const rows = await db.execute<{ created_at: Date }>(
          sql`SELECT created_at FROM tasks WHERE id = ${task.taskId}`,
        );
        expect(new Date(rows[0]?.created_at ?? 0)).toEqual(at);
      }));

    it('refuses an agent that can only read the area', () =>
      withRig(async (db, { viewer }) => {
        const agent = agentOf(viewer, 'laptop');
        const result = await createTask(db, agent, newTask(OTHER), randomUUID(), at);
        expect(result).toEqual({ ok: false, reason: 'not_permitted' });
      }));

    it('refuses a page that does not exist', () =>
      withRig(async (db, { editor }) => {
        const task = newTask(AREA, { pageId: randomUUID() });
        const result = await createTask(db, agentOf(editor, 'laptop'), task, randomUUID(), at);
        expect(result).toEqual({ ok: false, reason: 'page_not_found' });
      }));

    it('accepts a page in the same area', () =>
      withRig(async (db, { editor }) => {
        const task = newTask(AREA, { pageId: await linkedPage(db) });
        const result = await createTask(db, agentOf(editor, 'laptop'), task, randomUUID(), at);
        expect(result.ok).toBe(true);
      }));
  },
);

describe.skipIf(!testServer)('AB-5 open_tasks returns no task the principal could not read', () => {
  it('shows a viewer only the area they can read', () =>
    withRig(async (db, { editor, viewer }) => {
      const ids = await seedTasks(db, editor);
      expect(idsOf(await openTasks(db, viewer, OTHER, at))).toEqual([ids.elsewhere]);
      expect(await openTasks(db, viewer, AREA, at)).toEqual([]);
    }));

  it('shows an editor each area when asked for it', () =>
    withRig(async (db, { editor }) => {
      const ids = await seedTasks(db, editor);
      expect(idsOf(await openTasks(db, editor, AREA, at))).toEqual([ids.inArea]);
      expect(idsOf(await openTasks(db, editor, OTHER, at))).toEqual([ids.elsewhere]);
    }));

  it('leaves out done and dismissed tasks', () =>
    withRig(async (db, { editor }) => {
      const ids = await seedTasks(db, editor);
      await db.execute(sql`UPDATE tasks SET status = 'done' WHERE id = ${ids.inArea}`);
      expect(await openTasks(db, editor, AREA, at)).toEqual([]);
      await db.execute(sql`UPDATE tasks SET status = 'dismissed' WHERE id = ${ids.elsewhere}`);
      expect(await openTasks(db, editor, OTHER, at)).toEqual([]);
    }));

  it('returns at most 50 ordered by creation instant then id', () =>
    withRig(async (db, { editor }) => {
      const expected = await seedMany(db, editor);
      expect(idsOf(await openTasks(db, editor, AREA, at))).toEqual(expected);
    }));
});

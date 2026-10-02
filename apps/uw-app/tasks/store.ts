import { and, asc, eq, inArray } from 'drizzle-orm';
import { taskStatusSchema, type ErrorReason, type JdArea } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor } from '@uw/db/client';
import { tasks } from '@uw/db/schema';
import { readPage } from '../pages/store.ts';

export const owns = ['tasks'] as const;

const OPEN_TASK_LIMIT = 50;

type TaskRow = typeof tasks.$inferSelect;

type NewTask = {
  readonly taskId: string;
  readonly jdArea: JdArea;
  readonly title: string;
  readonly pageId: string | null;
  readonly due: string | null;
};

type TaskResult =
  | { readonly ok: true; readonly task: ReturnType<typeof toTask> }
  | { readonly ok: false; readonly reason: ErrorReason };

function toTask(row: TaskRow) {
  return {
    taskId: row.id,
    jdArea: row.jdArea,
    title: row.title,
    pageId: row.pageId,
    due: row.due,
    status: taskStatusSchema.parse(row.status),
    createdBy: row.createdBy,
  };
}

export async function createTask(
  db: Database,
  actor: Principal,
  task: NewTask,
  traceId: string,
  at: Date,
): Promise<TaskResult> {
  if (!can(actor, 'write', { kind: 'area', area: task.jdArea }, at)) {
    return { ok: false, reason: 'not_permitted' };
  }
  if (task.pageId !== null && (await readPage(db, actor, task.pageId, at)) === null) {
    return { ok: false, reason: 'page_not_found' };
  }
  const [row] = await db
    .insert(tasks)
    .values({
      id: task.taskId,
      jdArea: task.jdArea,
      title: task.title,
      pageId: task.pageId,
      due: task.due,
      status: 'suggested',
      createdBy: actor.identity,
      traceId,
      createdAt: at,
    })
    .returning();
  if (!row) throw new Error('an inserted task must return its row');
  return { ok: true, task: toTask(row) };
}

export async function openTasks(
  db: Executor,
  actor: Principal,
  jdArea: JdArea,
  at: Date,
): Promise<readonly ReturnType<typeof toTask>[]> {
  if (!can(actor, 'read', { kind: 'area', area: jdArea }, at)) return [];
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.jdArea, jdArea), inArray(tasks.status, ['suggested', 'open'])))
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
    .limit(OPEN_TASK_LIMIT);
  return rows.map(toTask);
}

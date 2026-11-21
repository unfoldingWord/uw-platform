import { eq } from 'drizzle-orm';
import { taskStatusSchema, type JdArea, type TaskStatus } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Transaction } from '@uw/db/client';
import { tasks } from '@uw/db/schema';

export const completeTaskStatuses: readonly TaskStatus[] = ['done', 'dismissed'];

export type TaskColumn =
  | 'title'
  | 'status'
  | 'due'
  | 'assignees'
  | 'priority'
  | 'tags'
  | 'description'
  | 'files'
  | 'source'
  | 'page_id'
  | 'related';

const fieldByColumn = {
  title: 'title',
  status: 'status',
  due: 'due',
  assignees: 'assignees',
  priority: 'priority',
  tags: 'tags',
  description: 'description',
  files: 'files',
  source: 'source',
  page_id: 'pageId',
  related: 'related',
} as const satisfies Record<TaskColumn, keyof typeof tasks.$inferInsert>;

const fields: ReadonlyMap<string, string> = new Map(Object.entries(fieldByColumn));

export type TaskRecord = {
  readonly id: string;
  readonly jdArea: JdArea;
  readonly status: TaskStatus;
};

export type TaskWrite = {
  readonly actor: Principal;
  readonly traceId: string;
  readonly at: Date;
};

export async function lockedTask(tx: Transaction, taskId: string): Promise<TaskRecord | null> {
  const [row] = await tx
    .select({ id: tasks.id, jdArea: tasks.jdArea, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .for('update');
  if (!row) return null;
  return { id: row.id, jdArea: row.jdArea, status: taskStatusSchema.parse(row.status) };
}

function completedAt(stored: TaskRecord, column: TaskColumn, value: unknown, at: Date) {
  if (column !== 'status' || value === stored.status) return {};
  const entering = completeTaskStatuses.includes(value as TaskStatus);
  const leaving = completeTaskStatuses.includes(stored.status);
  if (entering && !leaving) return { completedAt: at };
  if (!entering && leaving) return { completedAt: null };
  return {};
}

export async function writeTaskColumn(
  tx: Transaction,
  stored: TaskRecord,
  change: { readonly column: TaskColumn; readonly value: unknown },
  write: TaskWrite,
): Promise<void> {
  const field = fieldByColumn[change.column];
  await tx
    .update(tasks)
    .set({
      [field]: change.value,
      ...completedAt(stored, change.column, change.value, write.at),
      updatedBy: write.actor.identity,
      updatedAt: write.at,
    })
    .where(eq(tasks.id, stored.id));
}

export type NewTaskRow = {
  readonly taskId: string;
  readonly jdArea: JdArea;
  readonly title: string;
  readonly values: Partial<Record<TaskColumn, unknown>>;
};

export async function insertTaskRow(tx: Transaction, task: NewTaskRow, write: TaskWrite) {
  const set: Record<string, unknown> = Object.fromEntries(
    Object.entries(task.values).flatMap(([column, value]) => {
      const field = fields.get(column);
      return field === undefined || value === undefined || value === null ? [] : [[field, value]];
    }),
  );
  const status = taskStatusSchema.catch('open').parse(set['status'] ?? 'open');
  await tx.insert(tasks).values({
    ...set,
    id: task.taskId,
    jdArea: task.jdArea,
    title: task.title,
    status,
    completedAt: completeTaskStatuses.includes(status) ? write.at : null,
    createdBy: write.actor.identity,
    traceId: write.traceId,
    createdAt: write.at,
  });
}

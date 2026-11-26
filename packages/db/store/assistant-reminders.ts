import { assistantReminderStatusSchema } from '@uw/contracts';
import { and, asc, eq, lte } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantReminders } from '../schema.ts';
import { refusing } from './refusal.ts';
import type { AssistantReminderRow, AssistantRemindersGateway, ReminderClose } from './types.ts';

const READ_MOST = 200;

function toReminder(row: typeof assistantReminders.$inferSelect): AssistantReminderRow {
  return { ...row, status: assistantReminderStatusSchema.parse(row.status) };
}

function bounded(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > READ_MOST) {
    throw new RangeError(`a reminder read holds 1 to ${READ_MOST} reminders, not ${limit}`);
  }
  return limit;
}

async function byId(executor: AnyExecutor, reminderId: string) {
  const rows = await executor
    .select()
    .from(assistantReminders)
    .where(eq(assistantReminders.id, reminderId));
  return rows[0] ? toReminder(rows[0]) : null;
}

async function due(executor: AnyExecutor, at: Date, limit: number) {
  const rows = await executor
    .select()
    .from(assistantReminders)
    .where(and(eq(assistantReminders.status, 'set'), lte(assistantReminders.dueAt, at)))
    .orderBy(asc(assistantReminders.dueAt), asc(assistantReminders.id))
    .limit(bounded(limit));
  return rows.map(toReminder);
}

async function pending(executor: AnyExecutor, harnessId: string, limit: number) {
  const rows = await executor
    .select()
    .from(assistantReminders)
    .where(and(eq(assistantReminders.harnessId, harnessId), eq(assistantReminders.status, 'set')))
    .orderBy(asc(assistantReminders.dueAt), asc(assistantReminders.id))
    .limit(bounded(limit));
  return rows.map(toReminder);
}

async function close(executor: AnyExecutor, change: ReminderClose): Promise<boolean> {
  const updated = await executor
    .update(assistantReminders)
    .set({ status: change.to, closedAt: change.at })
    .where(and(eq(assistantReminders.id, change.id), eq(assistantReminders.status, change.from)))
    .returning({ id: assistantReminders.id });
  return updated.length === 1;
}

export function bindAssistantReminders(executor: AnyExecutor): AssistantRemindersGateway {
  return {
    read: {
      byId: (reminderId) => byId(executor, reminderId),
      due: (at, limit) => due(executor, at, limit),
      pending: (harnessId, limit) => pending(executor, harnessId, limit),
    },
    write: {
      insert: (row) =>
        refusing(async () => {
          await executor.insert(assistantReminders).values({ ...row });
        }),
      close: (change) => refusing(() => close(executor, change)),
    },
  };
}

import { assistantHoldStatusSchema } from '@uw/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantCalendarHolds } from '../schema.ts';
import { refusing } from './refusal.ts';
import type { AssistantHoldRow, AssistantHoldsGateway, HoldRelease } from './types.ts';

const READ_MOST = 200;

function toHold(row: typeof assistantCalendarHolds.$inferSelect): AssistantHoldRow {
  return { ...row, status: assistantHoldStatusSchema.parse(row.status) };
}

function bounded(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > READ_MOST) {
    throw new RangeError(`a hold read holds 1 to ${READ_MOST} holds, not ${limit}`);
  }
  return limit;
}

async function byId(executor: AnyExecutor, holdId: string) {
  const rows = await executor
    .select()
    .from(assistantCalendarHolds)
    .where(eq(assistantCalendarHolds.id, holdId));
  return rows[0] ? toHold(rows[0]) : null;
}

async function held(executor: AnyExecutor, harnessId: string, limit: number) {
  const rows = await executor
    .select()
    .from(assistantCalendarHolds)
    .where(
      and(
        eq(assistantCalendarHolds.harnessId, harnessId),
        eq(assistantCalendarHolds.status, 'held'),
      ),
    )
    .orderBy(asc(assistantCalendarHolds.startsAt), asc(assistantCalendarHolds.id))
    .limit(bounded(limit));
  return rows.map(toHold);
}

async function insert(executor: AnyExecutor, row: AssistantHoldRow): Promise<boolean> {
  const inserted = await executor
    .insert(assistantCalendarHolds)
    .values({ ...row })
    .onConflictDoNothing({ target: assistantCalendarHolds.id })
    .returning({ id: assistantCalendarHolds.id });
  return inserted.length === 1;
}

async function release(executor: AnyExecutor, change: HoldRelease): Promise<boolean> {
  const updated = await executor
    .update(assistantCalendarHolds)
    .set({ status: 'released', releasedEffectId: change.effectId, releasedAt: change.at })
    .where(and(eq(assistantCalendarHolds.id, change.id), eq(assistantCalendarHolds.status, 'held')))
    .returning({ id: assistantCalendarHolds.id });
  return updated.length === 1;
}

export function bindAssistantHolds(executor: AnyExecutor): AssistantHoldsGateway {
  return {
    read: {
      byId: (holdId) => byId(executor, holdId),
      held: (harnessId, limit) => held(executor, harnessId, limit),
    },
    write: {
      insert: (row) => refusing(() => insert(executor, row)),
      release: (change) => refusing(() => release(executor, change)),
    },
  };
}

import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AnyExecutor } from '../any-database.ts';
import {
  assistantCalendarHolds,
  assistantEffects,
  assistantReminders,
  assistantRequests,
} from '../schema.ts';
import type { RecentRequest, RedactedRequest, RedactQuery } from './types.ts';

const RECENT_MOST = 50;
const REDACT_MOST = 1000;

function bounded(limit: number, most: number, what: string): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > most) {
    throw new RangeError(`${what} holds 1 to ${most} rows, not ${limit}`);
  }
  return limit;
}

export async function recentRequests<T>(
  executor: AnyExecutor,
  harnessId: string,
  limit: number,
  toRequest: (row: typeof assistantRequests.$inferSelect) => T,
): Promise<readonly (T & Pick<RecentRequest, 'redactedAt'>)[]> {
  const rows = await executor
    .select()
    .from(assistantRequests)
    .where(eq(assistantRequests.harnessId, harnessId))
    .orderBy(desc(assistantRequests.recordedAt), desc(assistantRequests.id))
    .limit(bounded(limit, RECENT_MOST, 'a recent request read'));
  return rows.map((row) => ({ ...toRequest(row), redactedAt: row.redactedAt }));
}

function onHarness(column: AnyPgColumn, harnessId: string | null) {
  return harnessId === null ? undefined : eq(column, harnessId);
}

export async function redactRequests(
  executor: AnyExecutor,
  query: RedactQuery,
): Promise<readonly RedactedRequest[]> {
  const due = executor
    .select({ id: assistantRequests.id })
    .from(assistantRequests)
    .where(
      and(
        isNull(assistantRequests.redactedAt),
        lt(assistantRequests.recordedAt, query.before),
        onHarness(assistantRequests.harnessId, query.harnessId),
      ),
    )
    .orderBy(assistantRequests.recordedAt, assistantRequests.id)
    .limit(bounded(query.limit, REDACT_MOST, 'a redaction'));
  const rows = await executor
    .update(assistantRequests)
    .set({
      note: '',
      untrustedParts: sql`'[]'::jsonb`,
      researchSources: sql`'[]'::jsonb`,
      redactedAt: query.at,
    })
    .where(inArray(assistantRequests.id, due))
    .returning({ id: assistantRequests.id, harnessId: assistantRequests.harnessId });
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function redactEffects(
  executor: AnyExecutor,
  requestIds: readonly string[],
  at: Date,
): Promise<number> {
  if (requestIds.length === 0) return 0;
  const rows = await executor
    .update(assistantEffects)
    .set({ payload: sql`'{}'::jsonb`, redactedAt: at })
    .where(
      and(
        inArray(assistantEffects.requestId, [...requestIds]),
        isNull(assistantEffects.redactedAt),
      ),
    )
    .returning({ id: assistantEffects.id });
  return rows.length;
}

export async function redactReminders(executor: AnyExecutor, query: RedactQuery): Promise<number> {
  const due = executor
    .select({ id: assistantReminders.id })
    .from(assistantReminders)
    .where(
      and(
        isNull(assistantReminders.redactedAt),
        ne(assistantReminders.status, 'set'),
        lt(assistantReminders.closedAt, query.before),
        onHarness(assistantReminders.harnessId, query.harnessId),
      ),
    )
    .limit(bounded(query.limit, REDACT_MOST, 'a redaction'));
  const rows = await executor
    .update(assistantReminders)
    .set({ text: '', redactedAt: query.at })
    .where(inArray(assistantReminders.id, due))
    .returning({ id: assistantReminders.id });
  return rows.length;
}

export async function redactHolds(executor: AnyExecutor, query: RedactQuery): Promise<number> {
  const holds = assistantCalendarHolds;
  const due = executor
    .select({ id: holds.id })
    .from(holds)
    .where(
      and(
        isNull(holds.redactedAt),
        or(lt(holds.endsAt, query.before), lt(holds.releasedAt, query.before)),
        onHarness(holds.harnessId, query.harnessId),
      ),
    )
    .limit(bounded(query.limit, REDACT_MOST, 'a redaction'));
  const rows = await executor
    .update(holds)
    .set({ title: '', redactedAt: query.at })
    .where(inArray(holds.id, due))
    .returning({ id: holds.id });
  return rows.length;
}

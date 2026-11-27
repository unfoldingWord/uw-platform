import { and, asc, gte, lt, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { evidenceField } from '../assistant-event-indexes.ts';
import { assistantRequests, harnessEvents } from '../schema.ts';
import type { UnstartedQuery } from './types.ts';

const UNSTARTED_READ_MOST = 200;
const turnEventNames = sql.raw(`'assistant_turn_started', 'assistant_turn_refused'`);

function unstartedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > UNSTARTED_READ_MOST) {
    throw new RangeError(
      `an unstarted request read holds 1 to ${UNSTARTED_READ_MOST} requests, not ${limit}`,
    );
  }
  return limit;
}

function unstartedRequestsQuery(executor: AnyExecutor, query: UnstartedQuery) {
  const turned = sql`EXISTS (
    SELECT 1 FROM ${harnessEvents}
    WHERE ${harnessEvents.harnessId} = ${assistantRequests.harnessId}
      AND ${harnessEvents.name} IN (${turnEventNames})
      AND ${evidenceField(harnessEvents.evidence, 'requestId')} = ${assistantRequests.id}::text)`;
  return executor
    .select({ id: assistantRequests.id })
    .from(assistantRequests)
    .where(
      and(
        gte(assistantRequests.recordedAt, query.since),
        lt(assistantRequests.recordedAt, query.recordedBefore),
        sql`NOT ${turned}`,
      ),
    )
    .orderBy(asc(assistantRequests.recordedAt), asc(assistantRequests.id))
    .limit(unstartedLimit(query.limit));
}

export async function unstartedRequests(
  executor: AnyExecutor,
  query: UnstartedQuery,
): Promise<readonly string[]> {
  const rows = await unstartedRequestsQuery(executor, query);
  return rows.map((row) => row.id);
}

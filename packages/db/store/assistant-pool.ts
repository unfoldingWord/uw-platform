import { and, asc, count, gte, lt, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import {
  assistantFinishedEventName,
  assistantStartedEventName,
  evidenceField,
} from '../assistant-event-indexes.ts';
import { oneOf } from '../checks.ts';
import { harnessEvents, harnesses } from '../schema.ts';
import { costMicros, knownCost, sameTurnFinished } from './assistant-spend-sql.ts';
import type { AssistantMonthSpend, AssistantStaleTurn, AssistantStaleTurnQuery } from './types.ts';

const STALE_READ_MOST = 200;
const onPersonalHarness = sql`${harnessEvents.harnessId} IN (
  SELECT ${harnesses.id} FROM ${harnesses} WHERE ${harnesses.personId} IS NOT NULL)`;

function assistantPoolSpendQuery(executor: AnyExecutor, since: Date) {
  return executor
    .select({
      knownMicros:
        sql<string>`COALESCE(SUM(CASE WHEN ${knownCost} THEN (${costMicros})::bigint END), 0)::text`.as(
          'known_micros',
        ),
      unknownTurns: count(sql`CASE WHEN ${knownCost} THEN NULL ELSE 1 END`).as('unknown_turns'),
    })
    .from(harnessEvents)
    .where(
      and(
        onPersonalHarness,
        oneOf(harnessEvents.name, [assistantFinishedEventName]),
        gte(harnessEvents.at, since),
      ),
    );
}

function assistantPoolOpenQuery(executor: AnyExecutor, since: Date) {
  return executor
    .select({ openTurns: count().as('open_turns') })
    .from(harnessEvents)
    .where(
      and(
        onPersonalHarness,
        oneOf(harnessEvents.name, [assistantStartedEventName]),
        gte(harnessEvents.at, since),
        sql`NOT ${sameTurnFinished}`,
      ),
    );
}

function exact(value: unknown, what: string): number {
  const counted = Number(value ?? 0);
  if (!Number.isSafeInteger(counted)) throw new RangeError(`${what} ${String(value)} is not exact`);
  return counted;
}

export async function assistantPoolSpend(
  executor: AnyExecutor,
  since: Date,
): Promise<AssistantMonthSpend> {
  const finished = assistantPoolSpendQuery(executor, since).as('pool_finished');
  const open = assistantPoolOpenQuery(executor, since).as('pool_open');
  const [row] = await executor
    .select({
      knownMicros: finished.knownMicros,
      unknownTurns: finished.unknownTurns,
      openTurns: open.openTurns,
    })
    .from(finished)
    .crossJoin(open);
  return {
    knownMicros: exact(row?.knownMicros, 'an assistants pool of micros'),
    unknownTurns: exact(row?.unknownTurns, 'a count of unknown turns'),
    openTurns: exact(row?.openTurns, 'a count of open turns'),
  };
}

function staleLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > STALE_READ_MOST) {
    throw new RangeError(`a stale turn read holds 1 to ${STALE_READ_MOST} turns, not ${limit}`);
  }
  return limit;
}

function assistantStaleTurnsQuery(executor: AnyExecutor, query: AssistantStaleTurnQuery) {
  return executor
    .select({
      harnessId: harnessEvents.harnessId,
      requestId: sql<string>`${evidenceField(harnessEvents.evidence, 'requestId')}`,
      turnId: sql<string>`${evidenceField(harnessEvents.evidence, 'turnId')}`,
      startedAt: harnessEvents.at,
    })
    .from(harnessEvents)
    .where(
      and(
        onPersonalHarness,
        oneOf(harnessEvents.name, [assistantStartedEventName]),
        gte(harnessEvents.at, query.since),
        lt(harnessEvents.at, query.startedBefore),
        sql`NOT ${sameTurnFinished}`,
      ),
    )
    .orderBy(asc(harnessEvents.at), asc(harnessEvents.position))
    .limit(staleLimit(query.limit));
}

export async function assistantStaleTurns(
  executor: AnyExecutor,
  query: AssistantStaleTurnQuery,
): Promise<readonly AssistantStaleTurn[]> {
  const rows = await assistantStaleTurnsQuery(executor, query);
  return rows.map((row) => ({ ...row, startedAt: new Date(row.startedAt) }));
}

import { and, asc, count, gte, inArray, sql, type Column } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { gateDecisions, harnessRuns } from '../schema.ts';
import type { DayCount, HarnessDayCount } from './types.ts';

type Dated = typeof harnessRuns | typeof gateDecisions;

function utcDay(column: Column) {
  return sql<string>`((${column} AT TIME ZONE 'UTC')::date)::text`;
}

async function perDay(
  executor: AnyExecutor,
  table: Dated,
  at: Column,
  scope: { readonly harnessIds: readonly string[]; readonly since: Date },
): Promise<readonly DayCount[]> {
  if (scope.harnessIds.length === 0) return [];
  const day = utcDay(at);
  const rows = await executor
    .select({ day, count: count() })
    .from(table)
    .where(and(inArray(table.harnessId, [...scope.harnessIds]), gte(at, scope.since)))
    .groupBy(day)
    .orderBy(asc(day));
  return rows.map((row) => ({ day: row.day, count: row.count }));
}

export function startedPerDay(
  executor: AnyExecutor,
  harnessIds: readonly string[],
  since: Date,
): Promise<readonly DayCount[]> {
  return perDay(executor, harnessRuns, harnessRuns.startedAt, { harnessIds, since });
}

export function decidedPerDay(
  executor: AnyExecutor,
  harnessIds: readonly string[],
  since: Date,
): Promise<readonly DayCount[]> {
  return perDay(executor, gateDecisions, gateDecisions.decidedAt, { harnessIds, since });
}

export async function startedPerDayByHarness(
  executor: AnyExecutor,
  harnessIds: readonly string[],
  since: Date,
): Promise<readonly HarnessDayCount[]> {
  if (harnessIds.length === 0) return [];
  const day = utcDay(harnessRuns.startedAt);
  const rows = await executor
    .select({ harnessId: harnessRuns.harnessId, day, count: count() })
    .from(harnessRuns)
    .where(and(inArray(harnessRuns.harnessId, [...harnessIds]), gte(harnessRuns.startedAt, since)))
    .groupBy(harnessRuns.harnessId, day)
    .orderBy(asc(harnessRuns.harnessId), asc(day));
  return rows.map((row) => ({ harnessId: row.harnessId, day: row.day, count: row.count }));
}

import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import {
  measureRunKindSchema,
  observationOutcomeSchema,
  observationReasonSchema,
  observedValuesSchema,
  type MeasureRunKind,
  type ObservedValues,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { measureRuns, observationRecords, pages } from '@uw/db/schema';
import { areaFilter } from '../pages/reads.ts';
import type { Observed } from './metrics.ts';

export type ObservationRow = Observed & {
  readonly observationId: string;
  readonly runId: string;
  readonly runKind: MeasureRunKind;
  readonly resourceId: string;
  readonly measureVersion: number;
};

export type ObservationQuery = {
  readonly measureId: string;
  readonly resourceId: string | null;
  readonly since: Date | null;
  readonly limit: number;
  readonly offset: number;
};

const MOST_SERIES_ROWS = 20_000;
const MOST_TREND_POINTS = 400;
const LEAST_PER_RESOURCE = 2;

const columns = {
  observationId: observationRecords.id,
  runId: observationRecords.runId,
  runKind: measureRuns.kind,
  resourceId: observationRecords.resourcePageId,
  measureVersion: observationRecords.measureVersion,
  observedAt: observationRecords.observedAt,
  toolVersion: observationRecords.toolVersion,
  outcome: observationRecords.outcome,
  reason: observationRecords.reason,
  values: observationRecords.values,
};

type Raw = Omit<ObservationRow, 'runKind' | 'outcome' | 'reason' | 'values'> & {
  readonly runKind: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly values: unknown;
};

function valuesOf(values: unknown): ObservedValues | null {
  if (values === null) return null;
  const parsed = observedValuesSchema.safeParse(values);
  return parsed.success ? parsed.data : null;
}

function rowOf(raw: Raw): ObservationRow {
  return {
    ...raw,
    runKind: measureRunKindSchema.parse(raw.runKind),
    outcome: observationOutcomeSchema.parse(raw.outcome),
    reason: raw.reason === null ? null : observationReasonSchema.parse(raw.reason),
    values: valuesOf(raw.values),
  };
}

function perResource(resources: number): number {
  const share = Math.floor(MOST_SERIES_ROWS / Math.max(resources, 1));
  return Math.min(MOST_TREND_POINTS, Math.max(LEAST_PER_RESOURCE, share));
}

export async function seriesOf(
  db: Executor,
  measureId: string,
  request: { readonly resourceIds: readonly string[]; readonly trials: boolean },
): Promise<ReadonlyMap<string, readonly ObservationRow[]>> {
  if (request.resourceIds.length === 0) return new Map();
  const kinds = request.trials ? undefined : ne(measureRuns.kind, 'trial');
  const ranked = db
    .select({
      ...columns,
      rank: sql<number>`row_number() over (partition by ${observationRecords.resourcePageId} order by ${observationRecords.observedAt} desc, ${observationRecords.id} desc)`.as(
        'rank',
      ),
    })
    .from(observationRecords)
    .innerJoin(measureRuns, eq(measureRuns.id, observationRecords.runId))
    .where(
      and(
        eq(observationRecords.measurePageId, measureId),
        inArray(observationRecords.resourcePageId, [...request.resourceIds]),
        kinds,
      ),
    )
    .as('ranked');
  const rows = await db
    .select({
      observationId: ranked.observationId,
      runId: ranked.runId,
      runKind: ranked.runKind,
      resourceId: ranked.resourceId,
      measureVersion: ranked.measureVersion,
      observedAt: ranked.observedAt,
      toolVersion: ranked.toolVersion,
      outcome: ranked.outcome,
      reason: ranked.reason,
      values: ranked.values,
    })
    .from(ranked)
    .where(lte(ranked.rank, perResource(request.resourceIds.length)))
    .orderBy(asc(ranked.observedAt), asc(ranked.observationId));
  const series = new Map<string, ObservationRow[]>();
  for (const row of rows.map(rowOf)) {
    const list = series.get(row.resourceId) ?? [];
    list.push(row);
    series.set(row.resourceId, list);
  }
  return series;
}

function filtersOf(query: ObservationQuery, areas: SQL | undefined): SQL | undefined {
  return and(
    eq(observationRecords.measurePageId, query.measureId),
    query.resourceId === null ? undefined : eq(observationRecords.resourcePageId, query.resourceId),
    query.since === null ? undefined : gte(observationRecords.observedAt, query.since),
    areas,
  );
}

export async function readableObservations(
  db: Executor,
  actor: Principal,
  query: ObservationQuery,
  at: Date,
): Promise<{ readonly rows: readonly ObservationRow[]; readonly more: boolean }> {
  const areas = areaFilter(actor, at);
  if (areas === null) return { rows: [], more: false };
  const rows = await db
    .select(columns)
    .from(observationRecords)
    .innerJoin(measureRuns, eq(measureRuns.id, observationRecords.runId))
    .innerJoin(pages, eq(pages.id, observationRecords.resourcePageId))
    .where(filtersOf(query, areas))
    .orderBy(desc(observationRecords.observedAt), desc(observationRecords.id))
    .offset(query.offset)
    .limit(query.limit + 1);
  return { rows: rows.slice(0, query.limit).map(rowOf), more: rows.length > query.limit };
}

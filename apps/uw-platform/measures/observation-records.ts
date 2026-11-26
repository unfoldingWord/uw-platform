import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import {
  observationOutcomeSchema,
  observationReasonSchema,
  observedValuesSchema,
  type ObservationOutcome,
  type ObservationReason,
  type ObservedValues,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { observationRecords, pages } from '@uw/db/schema';
import type { FileStore } from '../pages/file-store.ts';

export type NewObservation = {
  readonly runId: string;
  readonly measurePageId: string;
  readonly measureVersion: number;
  readonly resourcePageId: string;
  readonly observedAt: Date;
  readonly toolVersion: string | null;
  readonly values: ObservedValues | null;
  readonly reason: ObservationReason | null;
  readonly raw: {
    readonly key: string;
    readonly sha256: string;
    readonly length: number;
  } | null;
  readonly area: string;
};

export type RunObservation = {
  readonly resourceId: string;
  readonly title: string;
  readonly resourceArea: string;
  readonly outcome: ObservationOutcome;
  readonly reason: ObservationReason | null;
  readonly toolVersion: string | null;
  readonly values: ObservedValues | null;
  readonly rawKey: string | null;
  readonly rawLength: number;
};

export async function recordObservation(db: Executor, made: NewObservation): Promise<void> {
  const { raw, reason, values, ...rest } = made;
  await db
    .insert(observationRecords)
    .values({
      ...rest,
      id: crypto.randomUUID(),
      outcome: reason === null ? 'ok' : 'failed',
      reason,
      values: reason === null ? values : null,
      rawKey: raw?.key ?? null,
      rawSha256: raw?.sha256 ?? null,
      rawLength: raw?.length ?? null,
    })
    .onConflictDoNothing({ target: [observationRecords.runId, observationRecords.resourcePageId] });
}

export async function observedIn(
  db: Executor,
  runId: string,
  resourceId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: observationRecords.id })
    .from(observationRecords)
    .where(
      and(eq(observationRecords.runId, runId), eq(observationRecords.resourcePageId, resourceId)),
    )
    .limit(1);
  return rows.length > 0;
}

export async function observationsOfRun(
  db: Executor,
  runId: string,
): Promise<readonly RunObservation[]> {
  const rows = await db
    .select({
      resourceId: observationRecords.resourcePageId,
      title: pages.title,
      resourceArea: pages.jdArea,
      outcome: observationRecords.outcome,
      reason: observationRecords.reason,
      toolVersion: observationRecords.toolVersion,
      values: observationRecords.values,
      rawKey: observationRecords.rawKey,
      rawLength: observationRecords.rawLength,
    })
    .from(observationRecords)
    .innerJoin(pages, eq(pages.id, observationRecords.resourcePageId))
    .where(eq(observationRecords.runId, runId))
    .orderBy(asc(pages.title), asc(observationRecords.resourcePageId));
  return rows.map((row) => ({
    ...row,
    rawLength: row.rawLength ?? 0,
    outcome: observationOutcomeSchema.parse(row.outcome),
    reason: row.reason === null ? null : observationReasonSchema.parse(row.reason),
    values: row.values === null ? null : observedValuesSchema.parse(row.values),
  }));
}

export async function expireRawOutput(
  db: Executor,
  files: FileStore,
  before: Date,
  limit: number,
): Promise<number> {
  const rows = await db
    .select({ id: observationRecords.id, rawKey: observationRecords.rawKey })
    .from(observationRecords)
    .where(and(isNotNull(observationRecords.rawKey), lt(observationRecords.observedAt, before)))
    .orderBy(asc(observationRecords.observedAt))
    .limit(limit);
  for (const row of rows) {
    if (row.rawKey !== null) await files.remove(row.rawKey);
    await db
      .update(observationRecords)
      .set({ rawKey: null, rawSha256: null, rawLength: null })
      .where(eq(observationRecords.id, row.id));
  }
  return rows.length;
}

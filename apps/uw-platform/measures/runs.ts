import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  measureRunKindSchema,
  measureRunStateSchema,
  type MeasureRunKind,
  type MeasureRunState,
} from '@uw/contracts';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import type { Database, Executor } from '@uw/db/client';
import { measureRuns, observationRecords } from '@uw/db/schema';

export type RunRecord = {
  readonly id: string;
  readonly measurePageId: string;
  readonly measureVersion: number;
  readonly toolHash: string;
  readonly kind: MeasureRunKind;
  readonly requestedBy: string;
  readonly state: MeasureRunState;
  readonly lock: string | null;
  readonly lockSha256: string | null;
  readonly refusedHosts: readonly string[];
  readonly area: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
};

export type NewRun = Pick<
  RunRecord,
  | 'id'
  | 'measurePageId'
  | 'measureVersion'
  | 'toolHash'
  | 'kind'
  | 'requestedBy'
  | 'lock'
  | 'lockSha256'
  | 'area'
  | 'createdAt'
>;

type Row = typeof measureRuns.$inferSelect;

const OPEN: readonly MeasureRunState[] = ['queued', 'running'];
const STALL_MS = 3_600_000;
const FINISHED_WITH_OUTPUT: readonly MeasureRunState[] = ['ok', 'partial'];

function hostsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((host) => typeof host === 'string') : [];
}

function recordOf(row: Row): RunRecord {
  return {
    ...row,
    kind: measureRunKindSchema.parse(row.kind),
    state: measureRunStateSchema.parse(row.state),
    refusedHosts: hostsOf(row.refusedHosts),
  };
}

export async function insertRun(db: Executor, run: NewRun): Promise<void> {
  await db.insert(measureRuns).values({ ...run, state: 'queued' });
}

export async function runById(db: Executor, runId: string): Promise<RunRecord | null> {
  const [row] = await db.select().from(measureRuns).where(eq(measureRuns.id, runId));
  return row === undefined ? null : recordOf(row);
}

export async function latestRunOf(db: Executor, measureId: string): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(measureRuns)
    .where(eq(measureRuns.measurePageId, measureId))
    .orderBy(desc(measureRuns.createdAt), desc(measureRuns.id))
    .limit(1);
  return row === undefined ? null : recordOf(row);
}

export async function markRunning(db: Executor, runId: string, at: Date): Promise<void> {
  await db
    .update(measureRuns)
    .set({
      state: 'running',
      startedAt: sql`coalesce(${measureRuns.startedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(and(eq(measureRuns.id, runId), eq(measureRuns.state, 'queued')));
}

export async function recordLock(
  db: Executor,
  runId: string,
  lock: { readonly lock: string; readonly lockSha256: string },
): Promise<void> {
  await db
    .update(measureRuns)
    .set(lock)
    .where(and(eq(measureRuns.id, runId), sql`${measureRuns.lock} IS NULL`));
}

export async function addRefusedHosts(
  db: Executor,
  runId: string,
  hosts: readonly string[],
): Promise<void> {
  if (hosts.length === 0) return;
  await db
    .update(measureRuns)
    .set({
      refusedHosts: sql`(SELECT coalesce(jsonb_agg(DISTINCT host ORDER BY host), '[]'::jsonb)
        FROM jsonb_array_elements_text(${measureRuns.refusedHosts} || ${JSON.stringify(hosts)}::jsonb) AS host)`,
    })
    .where(eq(measureRuns.id, runId));
}

export async function finishRun(
  db: Executor,
  runId: string,
  state: MeasureRunState,
  at: Date,
): Promise<void> {
  await db
    .update(measureRuns)
    .set({ state, finishedAt: at })
    .where(and(eq(measureRuns.id, runId), inArray(measureRuns.state, [...OPEN])));
}

function lastProgress() {
  return sql`greatest(${measureRuns.createdAt}, coalesce(${measureRuns.startedAt}, ${measureRuns.createdAt}),
    coalesce((SELECT max(${observationRecords.observedAt}) FROM ${observationRecords}
      WHERE ${observationRecords.runId} = ${measureRuns.id}), ${measureRuns.createdAt}))`;
}

function movingSince(at: Date) {
  return sql`${lastProgress()} > ${new Date(at.getTime() - STALL_MS).toISOString()}::timestamptz`;
}

export async function failStalledRuns(db: Executor, at: Date, limit: number): Promise<number> {
  const stalled = db
    .select({ id: measureRuns.id })
    .from(measureRuns)
    .where(
      and(
        inArray(measureRuns.state, [...OPEN]),
        isNotNull(measureRuns.startedAt),
        sql`NOT ${movingSince(at)}`,
      ),
    )
    .limit(limit);
  const rows = await db
    .update(measureRuns)
    .set({ state: 'stalled', finishedAt: at })
    .where(and(inArray(measureRuns.id, stalled), inArray(measureRuns.state, [...OPEN])))
    .returning({ id: measureRuns.id });
  return rows.length;
}

function launchedOpen() {
  return and(inArray(measureRuns.state, [...OPEN]), isNotNull(measureRuns.startedAt));
}

export async function openRunCount(db: Executor): Promise<number> {
  const [row] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(measureRuns)
    .where(launchedOpen());
  return row?.open ?? 0;
}

export async function claimSlot(
  db: Database,
  runId: string,
  slots: number,
  at: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(advisoryLock(advisoryLocks.measureRunSlots));
    if ((await openRunCount(tx)) >= slots) return false;
    const rows = await tx
      .update(measureRuns)
      .set({ startedAt: at })
      .where(
        and(
          eq(measureRuns.id, runId),
          eq(measureRuns.state, 'queued'),
          isNull(measureRuns.startedAt),
        ),
      )
      .returning({ id: measureRuns.id });
    return rows.length > 0;
  });
}

export async function waitingRuns(db: Executor, limit: number): Promise<readonly string[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ id: measureRuns.id })
    .from(measureRuns)
    .where(and(eq(measureRuns.state, 'queued'), isNull(measureRuns.startedAt)))
    .orderBy(asc(measureRuns.createdAt), asc(measureRuns.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function openTrialOf(
  db: Executor,
  measureId: string,
  toolHash: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: measureRuns.id })
    .from(measureRuns)
    .where(
      and(
        eq(measureRuns.measurePageId, measureId),
        eq(measureRuns.kind, 'trial'),
        eq(measureRuns.toolHash, toolHash),
        inArray(measureRuns.state, [...OPEN]),
        or(isNull(measureRuns.startedAt), movingSince(at)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function usableRunOf(
  db: Executor,
  measureId: string,
  toolHash: string,
  kinds: readonly MeasureRunKind[],
): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(measureRuns)
    .where(
      and(
        eq(measureRuns.measurePageId, measureId),
        inArray(measureRuns.kind, [...kinds]),
        eq(measureRuns.toolHash, toolHash),
        inArray(measureRuns.state, [...FINISHED_WITH_OUTPUT]),
        sql`${measureRuns.lock} IS NOT NULL`,
        sql`EXISTS (SELECT 1 FROM ${observationRecords} WHERE ${observationRecords.runId} = ${measureRuns.id} AND ${observationRecords.outcome} = 'ok')`,
      ),
    )
    .orderBy(desc(measureRuns.createdAt), desc(measureRuns.id))
    .limit(1);
  return row === undefined ? null : recordOf(row);
}

export function usableTrialOf(
  db: Executor,
  measureId: string,
  toolHash: string,
): Promise<RunRecord | null> {
  return usableRunOf(db, measureId, toolHash, ['trial']);
}

export async function requestedSince(
  db: Executor,
  measureId: string,
  since: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: measureRuns.id })
    .from(measureRuns)
    .where(
      and(
        eq(measureRuns.measurePageId, measureId),
        eq(measureRuns.kind, 'requested'),
        gt(measureRuns.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

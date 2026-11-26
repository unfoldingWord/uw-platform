import { and, asc, eq, isNull, lt, lte } from 'drizzle-orm';
import {
  measurePausedReasonSchema,
  type MeasurePausedReason,
  type PageStatus,
} from '@uw/contracts';
import type { Executor, Transaction } from '@uw/db/client';
import { measureActivations } from '@uw/db/schema';
import type { PageEffects } from '../pages/store.ts';

export type Activation = {
  readonly measurePageId: string;
  readonly version: number;
  readonly toolHash: string;
  readonly lock: string;
  readonly lockSha256: string;
  readonly activatorPersonId: string;
  readonly area: string;
  readonly activatedAt: Date;
  readonly nextRunAt: Date | null;
  readonly pausedReason: MeasurePausedReason | null;
};

type Row = typeof measureActivations.$inferSelect;

function activationOf(row: Row): Activation {
  const pausedReason =
    row.pausedReason === null ? null : measurePausedReasonSchema.parse(row.pausedReason);
  return { ...row, pausedReason };
}

export function activatable(status: PageStatus, activation: Activation | null): boolean {
  if (status === 'suggested') return true;
  const paused = activation?.pausedReason ?? null;
  return status === 'active' && paused !== null && paused !== 'retired';
}

export async function activationFor(db: Executor, measureId: string): Promise<Activation | null> {
  const [row] = await db
    .select()
    .from(measureActivations)
    .where(eq(measureActivations.measurePageId, measureId));
  return row === undefined ? null : activationOf(row);
}

export async function lockedActivation(
  tx: Transaction,
  measureId: string,
): Promise<Activation | null> {
  const [row] = await tx
    .select()
    .from(measureActivations)
    .where(eq(measureActivations.measurePageId, measureId))
    .for('update');
  return row === undefined ? null : activationOf(row);
}

export async function saveActivation(tx: Transaction, activation: Activation): Promise<void> {
  const { version, toolHash, lock, lockSha256, activatorPersonId, area } = activation;
  const { activatedAt, nextRunAt, pausedReason } = activation;
  const changed = { version, toolHash, lock, lockSha256, activatorPersonId, area };
  const timing = { activatedAt, nextRunAt, pausedReason };
  await tx
    .insert(measureActivations)
    .values(activation)
    .onConflictDoUpdate({
      target: measureActivations.measurePageId,
      set: { ...changed, ...timing },
    });
}

export async function pauseActivation(
  db: Executor,
  measureId: string,
  reason: MeasurePausedReason,
): Promise<void> {
  await db
    .update(measureActivations)
    .set({ pausedReason: reason, nextRunAt: null })
    .where(
      and(eq(measureActivations.measurePageId, measureId), isNull(measureActivations.pausedReason)),
    );
}

async function pauseActivationBefore(
  tx: Transaction,
  measureId: string,
  version: number,
  reason: MeasurePausedReason,
): Promise<void> {
  await tx
    .update(measureActivations)
    .set({ pausedReason: reason, nextRunAt: null })
    .where(
      and(
        eq(measureActivations.measurePageId, measureId),
        isNull(measureActivations.pausedReason),
        lt(measureActivations.version, version),
      ),
    );
}

export const measurePauses: PageEffects = {
  leftActive: async (tx, page) => {
    if (page.type !== 'measure') return;
    const reason = page.status === 'retired' ? 'retired' : 'changed';
    await pauseActivationBefore(tx, page.id, page.version, reason);
  },
};

export async function dueMeasures(
  db: Executor,
  at: Date,
  limit: number,
): Promise<readonly string[]> {
  const rows = await db
    .select({ id: measureActivations.measurePageId })
    .from(measureActivations)
    .where(and(isNull(measureActivations.pausedReason), lte(measureActivations.nextRunAt, at)))
    .orderBy(asc(measureActivations.nextRunAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function scheduleNext(tx: Transaction, measureId: string, next: Date): Promise<void> {
  await tx
    .update(measureActivations)
    .set({ nextRunAt: next })
    .where(eq(measureActivations.measurePageId, measureId));
}

export async function restoreSchedule(
  db: Executor,
  measureId: string,
  moved: { readonly from: Date; readonly to: Date },
): Promise<void> {
  await db
    .update(measureActivations)
    .set({ nextRunAt: moved.to })
    .where(
      and(
        eq(measureActivations.measurePageId, measureId),
        eq(measureActivations.nextRunAt, moved.from),
        isNull(measureActivations.pausedReason),
      ),
    );
}

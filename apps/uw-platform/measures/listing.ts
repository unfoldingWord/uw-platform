import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  measurePausedReasonSchema,
  pageStatusSchema,
  type MeasurePausedReason,
  type PageStatus,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { measureActivations, pages } from '@uw/db/schema';
import { areaFilter } from '../pages/reads.ts';

export type ListedMeasurePage = {
  readonly id: string;
  readonly type: 'measure' | 'dashboard';
  readonly title: string;
  readonly jdArea: string;
  readonly status: PageStatus;
  readonly nextRunAt: Date | null;
  readonly pausedReason: MeasurePausedReason | null;
  readonly activated: boolean;
};

const MOST_LISTED = 300;

export async function measuresAndDashboards(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly ListedMeasurePage[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const rows = await db
    .select({
      id: pages.id,
      type: pages.type,
      title: pages.title,
      jdArea: pages.jdArea,
      status: pages.status,
      nextRunAt: measureActivations.nextRunAt,
      pausedReason: measureActivations.pausedReason,
      activatedAt: measureActivations.activatedAt,
    })
    .from(pages)
    .leftJoin(measureActivations, eq(measureActivations.measurePageId, pages.id))
    .where(and(inArray(pages.type, ['measure', 'dashboard']), ne(pages.status, 'retired'), areas))
    .orderBy(asc(pages.type), asc(pages.title), asc(pages.id))
    .limit(MOST_LISTED);
  return rows.map((row) => ({
    id: row.id,
    type: row.type === 'measure' ? 'measure' : 'dashboard',
    title: row.title,
    jdArea: row.jdArea,
    status: pageStatusSchema.parse(row.status),
    nextRunAt: row.nextRunAt,
    pausedReason:
      row.pausedReason === null ? null : measurePausedReasonSchema.parse(row.pausedReason),
    activated: row.activatedAt !== null,
  }));
}

import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { measureRuns, observationRecords } from '@uw/db/schema';
import { resourcesInContext, type ContextResource } from './context-resources.ts';
import { readableMeasure, type DashboardPage, type MeasurePage } from './measure-pages.ts';
import type { Reader } from './metric-reads.ts';
import { readableDashboard } from './previews.ts';

export type ReportCard = {
  readonly measure: MeasurePage;
  readonly dashboard: DashboardPage;
  readonly hostPageId: string;
};

const MOST_CARDS = 10;

export type Serving = {
  readonly resources: readonly ContextResource[];
  readonly measureIds: readonly string[];
};

async function measuresOf(db: Executor, resourceIds: readonly string[]): Promise<string[]> {
  if (resourceIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ measureId: observationRecords.measurePageId })
    .from(observationRecords)
    .innerJoin(measureRuns, eq(measureRuns.id, observationRecords.runId))
    .where(
      and(
        inArray(observationRecords.resourcePageId, [...resourceIds]),
        ne(measureRuns.kind, 'trial'),
      ),
    )
    .limit(MOST_CARDS);
  return rows.map((row) => row.measureId);
}

async function observedAmong(
  db: Executor,
  measureId: string,
  resources: readonly ContextResource[],
): Promise<boolean> {
  if (resources.length === 0) return false;
  const rows = await db
    .select({ id: observationRecords.id })
    .from(observationRecords)
    .innerJoin(measureRuns, eq(measureRuns.id, observationRecords.runId))
    .where(
      and(
        eq(observationRecords.measurePageId, measureId),
        inArray(
          observationRecords.resourcePageId,
          resources.map((resource) => resource.resourceId),
        ),
        ne(measureRuns.kind, 'trial'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function cardOf(reader: Reader, measureId: string, pageId: string) {
  const measure = await readableMeasure(reader.db, reader.actor, measureId, reader.at);
  const cardId = measure?.measure.report_card ?? null;
  if (measure?.status !== 'active' || cardId === null) return null;
  const dashboard = await readableDashboard(reader, cardId);
  if (dashboard?.status !== 'active' || dashboard.context.kind !== 'host') return null;
  const context = {
    kind: 'page',
    page_id: pageId,
    descendants: dashboard.context.descendants,
  } as const;
  const readable = await resourcesInContext(reader.db, reader.actor, context, reader.at);
  const observed = await observedAmong(reader.db, measureId, readable);
  return observed ? { measure, dashboard, hostPageId: pageId } : null;
}

export async function readableServing(reader: Reader, pageId: string): Promise<Serving> {
  const context = { kind: 'page', page_id: pageId, descendants: true } as const;
  const resources = await resourcesInContext(reader.db, reader.actor, context, reader.at);
  const ids = resources.map((resource) => resource.resourceId);
  return { resources, measureIds: await measuresOf(reader.db, ids) };
}

export async function reportCardsFor(
  reader: Reader,
  pageId: string,
): Promise<readonly ReportCard[]> {
  const { measureIds } = await readableServing(reader, pageId);
  const cards: ReportCard[] = [];
  for (const measureId of measureIds) {
    const card = await cardOf(reader, measureId, pageId);
    if (card !== null && !cards.some((each) => each.dashboard.id === card.dashboard.id))
      cards.push(card);
  }
  return cards;
}

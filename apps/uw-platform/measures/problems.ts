import type { AuthoringProblem, DashboardContext, MeasureFrontmatter, Panel } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import {
  dashboardPageOf,
  readableMeasure,
  readablePagesOfType,
  type MeasurePage,
} from './measure-pages.ts';
import { resourcesOfView } from './resources.ts';

type Reader = { readonly db: Executor; readonly actor: Principal; readonly at: Date };

const NO_VIEW = 'names no saved view of the Resources collection you can read';
const NO_DASHBOARD = 'names no dashboard you can read';
const NOT_HOST =
  'names a dashboard whose context kind is not host: a report card is a dashboard whose context kind is host, so it shows the page it is shown on';
const NO_MEASURE = 'names no measure you can read';
const NO_METRIC = 'names no metric of that measure';
const NO_VALUE = 'names no value that measure keeps';
const NO_PAGE = 'names no page you can read';
const NO_RESOURCE = 'names no resource you can read';

function problem(path: string, message: string): AuthoringProblem {
  return { path, message };
}

export async function measureProblems(
  reader: Reader,
  measure: MeasureFrontmatter,
): Promise<AuthoringProblem[]> {
  const { db, actor, at } = reader;
  const found: AuthoringProblem[] = [];
  const listed = await resourcesOfView(db, actor, { viewId: measure.resources.view, most: 1 }, at);
  if (listed === null) found.push(problem('measure.resources.view', NO_VIEW));
  if (measure.report_card !== null)
    found.push(...(await cardProblems(reader, measure.report_card)));
  return found;
}

async function cardProblems(reader: Reader, dashboardId: string): Promise<AuthoringProblem[]> {
  const { db, actor, at } = reader;
  const request = { ids: [dashboardId], types: ['dashboard'] };
  const readable = await readablePagesOfType(db, actor, request, at);
  if (readable.size === 0) return [problem('measure.report_card', NO_DASHBOARD)];
  const dashboard = await dashboardPageOf(db, dashboardId);
  return dashboard?.context.kind === 'host' ? [] : [problem('measure.report_card', NOT_HOST)];
}

function panelKeys(panel: Panel, measure: MeasurePage, index: number): AuthoringProblem[] {
  const metrics = new Set(measure.measure.metrics.map((metric) => metric.key));
  const values = new Set(measure.measure.values.map((value) => value.key));
  const at = `panels.${index}`;
  if (panel.kind === 'figure' || panel.kind === 'bars' || panel.kind === 'trend') {
    return metrics.has(panel.metric) ? [] : [problem(`${at}.metric`, NO_METRIC)];
  }
  if (panel.kind === 'table') {
    return panel.values.flatMap((column, position) =>
      values.has(column.value) ? [] : [problem(`${at}.values.${position}.value`, NO_VALUE)],
    );
  }
  if (panel.kind === 'list') {
    return values.has(panel.value) ? [] : [problem(`${at}.value`, NO_VALUE)];
  }
  return [];
}

async function panelProblems(reader: Reader, panels: readonly Panel[]) {
  const measures = new Map<string, MeasurePage | null>();
  const found: AuthoringProblem[] = [];
  for (const [index, panel] of panels.entries()) {
    if (!measures.has(panel.measure)) {
      const read = await readableMeasure(reader.db, reader.actor, panel.measure, reader.at);
      measures.set(panel.measure, read);
    }
    const measure = measures.get(panel.measure) ?? null;
    if (measure === null) found.push(problem(`panels.${index}.measure`, NO_MEASURE));
    else found.push(...panelKeys(panel, measure, index));
  }
  return found;
}

async function contextProblems(reader: Reader, context: DashboardContext) {
  const { db, actor, at } = reader;
  if (context.kind === 'page') {
    const request = { ids: [context.page_id], types: null };
    const readable = await readablePagesOfType(db, actor, request, at);
    return readable.size === 0 ? [problem('context.page_id', NO_PAGE)] : [];
  }
  if (context.kind !== 'resources') return [];
  const request = { ids: context.resource_ids, types: ['resource'] };
  const readable = await readablePagesOfType(db, actor, request, at);
  return context.resource_ids.flatMap((id, index) =>
    readable.has(id) ? [] : [problem(`context.resource_ids.${index}`, NO_RESOURCE)],
  );
}

export async function dashboardProblems(
  reader: Reader,
  dashboard: { readonly context: DashboardContext; readonly panels: readonly Panel[] },
): Promise<AuthoringProblem[]> {
  return [
    ...(await contextProblems(reader, dashboard.context)),
    ...(await panelProblems(reader, dashboard.panels)),
  ];
}

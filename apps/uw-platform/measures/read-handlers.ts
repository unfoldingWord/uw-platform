import type { Context } from 'hono';
import { csvCell } from '../collections/read-handlers.ts';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { csvCellText, panelTable } from '../views/parts/panel-table.ts';
import { dashboardRead } from './dashboard-reads.ts';
import { readableMeasure } from './measure-pages.ts';
import type { Reader } from './metric-reads.ts';
import { readableObservations } from './observation-reads.ts';
import { readableDashboard } from './previews.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JSON_ROWS = 200;

function readerOf(c: Context<AppEnv>): Reader | Response {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  return { db: database.db, actor, at: c.get('now') };
}

function idOf(raw: string | undefined): string | null {
  return raw !== undefined && UUID.test(raw) ? raw : null;
}

export async function measureJson(c: Context<AppEnv>): Promise<Response> {
  const reader = readerOf(c);
  if (reader instanceof Response) return reader;
  const measureId = idOf(c.req.param('measureId'));
  const measure =
    measureId === null
      ? null
      : await readableMeasure(reader.db, reader.actor, measureId, reader.at);
  if (measure === null) return refuse(c, 'page_not_found');
  const query = {
    measureId: measure.id,
    resourceId: null,
    since: null,
    limit: JSON_ROWS,
    offset: 0,
  };
  const read = await readableObservations(reader.db, reader.actor, query, reader.at);
  c.header('cache-control', 'no-store');
  return c.json({
    measureId: measure.id,
    title: measure.title,
    version: measure.version,
    status: measure.status,
    measure: measure.measure,
    observations: read.rows,
    more: read.more,
  });
}

async function dashboardOf(c: Context<AppEnv>, reader: Reader) {
  const dashboardId = idOf(c.req.param('dashboardId'));
  const dashboard = dashboardId === null ? null : await readableDashboard(reader, dashboardId);
  if (dashboard === null) return null;
  return { dashboard, read: await dashboardRead(reader, dashboard, idOf(c.req.query('host'))) };
}

export async function dashboardJson(c: Context<AppEnv>): Promise<Response> {
  const reader = readerOf(c);
  if (reader instanceof Response) return reader;
  const found = await dashboardOf(c, reader);
  if (found === null) return refuse(c, 'page_not_found');
  const { dashboard, read } = found;
  c.header('cache-control', 'no-store');
  return c.json({
    dashboardId: dashboard.id,
    title: dashboard.title,
    version: dashboard.version,
    status: dashboard.status,
    context: read.context,
    panels: read.panels.map((placed) => ({
      index: placed.index,
      panel: placed.panel,
      readable: placed.read !== null,
      data: placed.read?.data ?? null,
    })),
  });
}

export async function panelCsv(c: Context<AppEnv>): Promise<Response> {
  const reader = readerOf(c);
  if (reader instanceof Response) return reader;
  const found = await dashboardOf(c, reader);
  const index = Number(c.req.param('index'));
  const placed = found?.read.panels.find((each) => each.index === index);
  const read = placed?.read ?? null;
  if (found === null || placed === undefined || read === null || read.data === null) {
    return refuse(c, 'page_not_found');
  }
  const table = panelTable(placed.panel, read.data, read.measure);
  const header = table.columns.map((column) => csvCell(column.label)).join(',');
  const lines = table.rows.map((row) =>
    table.columns.map((column) => csvCell(csvCellText(row[column.key]))).join(','),
  );
  c.header('content-disposition', `attachment; filename="panel-${String(index)}.csv"`);
  c.header('cache-control', 'no-store');
  return c.body([header, ...lines].join('\n'), 200, { 'content-type': 'text/csv; charset=utf-8' });
}

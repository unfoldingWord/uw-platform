import type { Context } from 'hono';
import { z } from 'zod';
import { formatDate } from '@uw/core/dates';
import { appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { requestLogger } from '../request-logger.ts';
import { csvOf } from './csv.ts';
import { pngRasteriserOf } from './png.ts';
import { renderedOf, type DrawnChart } from './render.ts';

export const chartFormatSchema = z.enum(['json', 'svg', 'csv', 'png']);
type ChartFormat = z.infer<typeof chartFormatSchema>;

const viewBox = /viewBox="0 0 (\d+) (\d+)"/;

function attachment(c: Context<AppEnv>, name: string, format: ChartFormat): void {
  c.header(
    'content-disposition',
    `attachment; filename="${name}-${formatDate(c.get('now'))}.${format}"`,
  );
  c.header('cache-control', 'no-store');
}

function standaloneSvg(svg: string, origin: string): string {
  const sheet = `<?xml-stylesheet type="text/css" href="${origin}${appCssPath}"?>`;
  return `<?xml version="1.0" encoding="UTF-8"?>${sheet}${svg}`;
}

async function pngOf(c: Context<AppEnv>, drawn: DrawnChart, svg: string): Promise<Response> {
  const rasteriser = pngRasteriserOf(c.env, requestLogger(c));
  if (rasteriser === null) return refuse(c, 'not_wired');
  const [, width = '1080', height = '280'] = viewBox.exec(svg) ?? [];
  const job = { title: drawn.spec.title, svg, width: Number(width), height: Number(height) };
  const bytes = await rasteriser.png(job);
  if (bytes === null) return refuse(c, 'chart_png_failed');
  return c.body(Uint8Array.from(bytes), 200, { 'content-type': 'image/png' });
}

export async function chartResponse(
  c: Context<AppEnv>,
  drawn: DrawnChart,
  format: ChartFormat,
  name: string,
): Promise<Response> {
  const rendered = renderedOf(drawn);
  if (format === 'json') {
    c.header('cache-control', 'no-store');
    return c.json(rendered);
  }
  attachment(c, name, format);
  if (format === 'csv') {
    return c.body(csvOf(rendered.table), 200, { 'content-type': 'text/csv; charset=utf-8' });
  }
  if (format === 'png') return pngOf(c, drawn, rendered.svg);
  const svg = standaloneSvg(rendered.svg, new URL(c.req.url).origin);
  return c.body(svg, 200, { 'content-type': 'image/svg+xml; charset=utf-8' });
}

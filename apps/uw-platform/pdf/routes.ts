import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { binderRequestSchema, pdfExportReplySchema, type BinderRequest } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { boundedJson } from '../http/body.ts';
import { formGuard } from '../http/form-guard.ts';
import { refuse } from '../http/outcomes.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { bufferOf } from '../pages/files.ts';
import { exportScreen } from '../views/screens/export.tsx';
import {
  exportFilePath,
  exportPath,
  queueExport,
  readExport,
  type ExportRecord,
} from './exports.ts';
import { binderPlan, binderReference } from './print-targets.ts';

type Asked = { readonly request: BinderRequest; readonly form: boolean };
type Posted = Record<string, string | File | (string | File)[]>;

const formTypes = ['application/x-www-form-urlencoded', 'multipart/form-data'];
const LONGEST_NAME = 80;

function isForm(c: Context<AppEnv>): boolean {
  const type = (c.req.header('content-type') ?? '').toLowerCase();
  return formTypes.some((form) => type.startsWith(form));
}

function texts(value: Posted[string] | undefined): readonly string[] {
  return [value ?? []].flat().filter((each): each is string => typeof each === 'string');
}

function formFields(posted: Posted): Record<string, unknown> {
  const filled = (value: Posted[string] | undefined) => texts(value).filter((each) => each !== '');
  const pageIds = filled(posted['pageIds']);
  const fields = {
    kind: filled(posted['kind'])[0],
    title: filled(posted['title'])[0],
    rootPageId: filled(posted['rootPageId'])[0],
    pageIds: pageIds.length === 0 ? undefined : pageIds,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

async function askedOf(c: Context<AppEnv>): Promise<Asked | null> {
  const form = isForm(c);
  const json = form ? null : await boundedJson(c.req.raw);
  const body = form ? formFields(await c.req.parseBody({ all: true })) : json?.ok && json.value;
  const parsed = binderRequestSchema.safeParse(body);
  return parsed.success ? { request: parsed.data, form } : null;
}

function wired(c: Context<AppEnv>): boolean {
  return c.env.PDF_EXPORT !== undefined && c.env.FILES !== undefined && c.env.BROWSER !== undefined;
}

async function queueBinder(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (!wired(c) || c.env.PDF_EXPORT === undefined) return refuse(c, 'not_wired');
  const asked = await askedOf(c);
  if (asked === null) return refuse(c, 'malformed_command');
  const at = c.get('now');
  const plan = await binderPlan(database.db, actor, asked.request, at);
  if (typeof plan === 'string') return refuse(c, plan);
  const { title, areas } = plan;
  const reference = binderReference(plan);
  const input = { kind: 'binder' as const, title, reference, areas, request: asked.request };
  const { exportId } = await queueExport(database.db, { ...input, actor, at });
  const params = { exportId, traceId: c.get('traceId') };
  await c.env.PDF_EXPORT.create({ id: exportId, params });
  c.set('outcome', 'accepted');
  if (asked.form) return c.redirect(exportPath(exportId), 303);
  const reply = { exportId, status: 'queued', file: exportFilePath(exportId), sha256: null };
  return c.json(pdfExportReplySchema.parse({ ...reply, bytes: null }), 202);
}

async function foundExport(c: Context<AppEnv>): Promise<ExportRecord | Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const exportId = z.uuid().safeParse(c.req.param('exportId'));
  const found = exportId.success
    ? await readExport(database.db, actor, exportId.data, c.get('now'))
    : null;
  return found ?? refuse(c, 'export_not_found');
}

async function readReply(c: Context<AppEnv>): Promise<Response> {
  const found = await foundExport(c);
  if (found instanceof Response) return found;
  const { exportId, status, file, sha256, bytes } = found;
  c.set('outcome', 'accepted');
  return c.json(pdfExportReplySchema.parse({ exportId, status, file, sha256, bytes }), 200);
}

function fileNameOf(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LONGEST_NAME)
    .replace(/-+$/, '');
  return `${slug === '' ? 'export' : slug}.pdf`;
}

async function downloadExport(c: Context<AppEnv>): Promise<Response> {
  if (c.env.FILES === undefined) return refuse(c, 'not_wired');
  const found = await foundExport(c);
  if (found instanceof Response) return found;
  if (found.status === 'queued') return refuse(c, 'export_not_ready');
  const stored = found.r2Key === null ? null : await bucketFiles(c.env.FILES).get(found.r2Key);
  if (stored === null || found.sha256 === null) return refuse(c, 'export_not_found');
  c.set('outcome', 'accepted');
  return c.body(bufferOf(stored.bytes), 200, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${fileNameOf(found.title)}"`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
    'x-uw-sha256': found.sha256,
  });
}

function exportApiRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('/', formGuard);
  routes.post('/', queueBinder);
  routes.get('/:exportId/file', downloadExport);
  routes.get('/:exportId', readReply);
  return routes;
}

function exportScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/:exportId', exportScreen);
  return routes;
}

export function mountExports(app: Hono<AppEnv>): void {
  app.route('/api/exports', exportApiRoutes());
  app.route('/exports', exportScreenRoutes());
}

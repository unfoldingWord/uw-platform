import type { Context } from 'hono';
import {
  collectionListReplySchema,
  collectionReplySchema,
  rowsReplySchema,
  type CollectionRow,
  type RowsReply,
} from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import {
  loadCollection,
  readableCollections,
  summaryOf,
  type StoredCollection,
} from './definitions.ts';
import { cellText, namesFor, valueOf } from './display.ts';
import { mayReadCollection } from './reader.ts';
import { collectionReply, viewRows } from './replies.ts';

type Scene = {
  readonly db: NonNullable<AppEnv['Variables']['database']>['db'];
  readonly actor: NonNullable<AppEnv['Variables']['principal']>;
  readonly at: Date;
};

function sceneOf(c: Context<AppEnv>): Scene | Response {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  return { db: database.db, actor, at: c.get('now') };
}

async function readable(c: Context<AppEnv>, scene: Scene): Promise<StoredCollection | null> {
  const stored = await loadCollection(scene.db, c.req.param('key') ?? '');
  if (stored === null || !mayReadCollection(stored, scene.actor, scene.at)) return null;
  return stored;
}

export async function listCollections(c: Context<AppEnv>): Promise<Response> {
  const scene = sceneOf(c);
  if (scene instanceof Response) return scene;
  const found = await readableCollections(scene.db, scene.actor, scene.at);
  return c.json(collectionListReplySchema.parse({ collections: found.map(summaryOf) }));
}

export async function readCollection(c: Context<AppEnv>): Promise<Response> {
  const scene = sceneOf(c);
  if (scene instanceof Response) return scene;
  const stored = await readable(c, scene);
  if (stored === null) return refuse(c, 'collection_not_found');
  return c.json(
    collectionReplySchema.parse(await collectionReply(scene.db, stored, scene.actor, scene.at)),
  );
}

async function rowsFor(
  c: Context<AppEnv>,
  scene: Scene,
  limit: number,
): Promise<RowsReply | Response> {
  const stored = await readable(c, scene);
  if (stored === null) return refuse(c, 'collection_not_found');
  const cursor = c.req.query('cursor') ?? null;
  const safeCursor = cursor !== null && /^[0-9]{1,7}$/.test(cursor) ? cursor : null;
  const read = await viewRows(scene.db, stored, scene.actor, scene.at, {
    viewId: c.req.param('viewId') ?? '',
    limit,
    cursor: safeCursor,
  });
  if (!read.ok) return refuse(c, read.reason);
  return read.value;
}

export async function readViewRows(c: Context<AppEnv>): Promise<Response> {
  const scene = sceneOf(c);
  if (scene instanceof Response) return scene;
  const rows = await rowsFor(c, scene, 50);
  if (rows instanceof Response) return rows;
  return c.json(rowsReplySchema.parse(rows));
}

const EXPORT_CAP = 5000;

export function csvCell(text: string): string {
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

async function allRows(
  c: Context<AppEnv>,
  scene: Scene,
): Promise<{ reply: RowsReply; rows: CollectionRow[]; cut: boolean } | Response> {
  const stored = await readable(c, scene);
  if (stored === null) return refuse(c, 'collection_not_found');
  const viewId = c.req.param('viewId') ?? '';
  const rows: CollectionRow[] = [];
  let cursor: string | null = null;
  let reply: RowsReply;
  do {
    const read = await viewRows(scene.db, stored, scene.actor, scene.at, {
      viewId,
      limit: 200,
      cursor,
    });
    if (!read.ok) return refuse(c, read.reason);
    reply = read.value;
    rows.push(...reply.rows);
    cursor = reply.next;
  } while (cursor !== null && rows.length < EXPORT_CAP);
  return {
    reply,
    rows: rows.slice(0, EXPORT_CAP),
    cut: cursor !== null || rows.length > EXPORT_CAP,
  };
}

export async function exportView(c: Context<AppEnv>): Promise<Response> {
  const scene = sceneOf(c);
  if (scene instanceof Response) return scene;
  const found = await allRows(c, scene);
  if (found instanceof Response) return found;
  const { reply, rows, cut } = found;
  const stored = await loadCollection(scene.db, reply.collection);
  const properties = reply.columns.flatMap(
    (column) => stored?.definition.properties.filter((p) => p.key === column.key) ?? [],
  );
  const names = await namesFor(scene.db, rows, properties);
  const header = properties.map((p) => csvCell(p.name)).join(',');
  const lines = rows.map((row) =>
    properties.map((p) => csvCell(cellText(p, valueOf(row, p.key), names))).join(','),
  );
  const notice = cut
    ? [csvCell(`Stopped at ${EXPORT_CAP} rows; filter the view to export the rest.`)]
    : [];
  c.header('content-disposition', `attachment; filename="${reply.collection}.csv"`);
  c.header('cache-control', 'no-store');
  c.header('x-uw-export-cut', cut ? 'true' : 'false');
  const body = [header, ...lines, ...notice].join('\n');
  return c.body(body, 200, { 'content-type': 'text/csv; charset=utf-8' });
}

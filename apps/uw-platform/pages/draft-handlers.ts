import type { Context } from 'hono';
import { z } from 'zod';
import type { Grant } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { capabilitiesOn } from './capabilities.ts';
import { AUTHORIZED_MS } from './draft-rules.ts';
import { draftsOf } from './drafts.ts';
import { readPage } from './store.ts';

const UPGRADE_REQUIRED = 426;
const pageParam = z.uuid();
const versionParam = z.coerce.number().int().min(1);
const connectionParam = z.string().regex(/^[\w-]{1,64}$/);

type Asked = { readonly pageId: string; readonly version: number; readonly connection: string };

function askedOf(c: Context<AppEnv>): Asked | null {
  const pageId = pageParam.safeParse(c.req.param('pageId'));
  const version = versionParam.safeParse(c.req.query('v'));
  const connection = connectionParam.safeParse(c.req.query('_pk'));
  if (!pageId.success || !version.success || !connection.success) return null;
  return { pageId: pageId.data, version: version.data, connection: connection.data };
}

function asksForSocket(c: Context<AppEnv>): boolean {
  return c.req.header('upgrade')?.toLowerCase() === 'websocket';
}

const WRITERS: ReadonlySet<string> = new Set(['editor', 'admin']);

export function writableUntil(grants: readonly Grant[], area: string, at: Date): number {
  const ends = grants
    .filter((grant) => WRITERS.has(grant.role))
    .filter((grant) => grant.scopeKind === 'org' || grant.scopeArea === area)
    .map((grant) => (grant.expiresAt === null ? Infinity : Date.parse(grant.expiresAt)));
  const latest = ends.length === 0 ? at.getTime() : Math.max(...ends);
  return Math.min(latest, at.getTime() + AUTHORIZED_MS);
}

export async function connectDraft(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (!asksForSocket(c)) {
    c.set('outcome', 'malformed_command');
    return c.json({ status: 'error', reason: 'malformed_command' }, UPGRADE_REQUIRED);
  }
  const asked = askedOf(c);
  if (asked === null) return refuse(c, 'malformed_command');
  const at = c.get('now');
  const page = await readPage(database.db, actor, asked.pageId, at);
  if (page === null) return refuse(c, 'page_not_found');
  const mayEdit = actor.kind === 'person' && capabilitiesOn(actor, page, at).canEdit;
  if (!mayEdit) return refuse(c, 'not_permitted');
  if (page.version !== asked.version) return refuse(c, 'stale_version');
  const drafts = draftsOf(c.env);
  if (drafts === null) return refuse(c, 'not_wired');
  c.set('outcome', 'accepted');
  const until = writableUntil(actor.grants, page.jdArea, at);
  return drafts.connect({
    pageId: page.id,
    version: page.version,
    connectionId: asked.connection,
    until,
  });
}

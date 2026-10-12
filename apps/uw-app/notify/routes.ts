import { Hono, type Context } from 'hono';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { readJson } from '../http/commands.ts';
import { refuse } from '../http/outcomes.ts';
import { notifyConfigOf } from './config.ts';
import { pushStore } from './push/store.ts';

type Caller = { readonly db: Executor; readonly personId: string };

function callerOf(c: Context<AppEnv>): Caller | Response {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const principal = c.get('principal');
  if (principal === null) return refuse(c, 'unauthenticated');
  if (principal.kind !== 'person' || principal.personId === null) {
    return refuse(c, 'not_permitted');
  }
  return { db: database.db, personId: principal.personId };
}

function accepted(c: Context<AppEnv>): Response {
  c.set('outcome', 'accepted');
  return c.json({ status: 'accepted' }, 200);
}

function handleKey(c: Context<AppEnv>): Response {
  const caller = callerOf(c);
  if (caller instanceof Response) return caller;
  const push = notifyConfigOf(c.env).push;
  if (push === null) return refuse(c, 'not_wired');
  c.set('outcome', 'accepted');
  return c.json({ status: 'accepted', publicKey: push.publicKey }, 200);
}

async function handleSubscribe(c: Context<AppEnv>): Promise<Response> {
  const caller = callerOf(c);
  if (caller instanceof Response) return caller;
  const parsed = pushSubscribeSchema.safeParse(await readJson(c));
  if (!parsed.success) return refuse(c, 'malformed_command');
  await pushStore(caller.db).subscribe(caller.personId, parsed.data, c.get('now'));
  return accepted(c);
}

async function handleUnsubscribe(c: Context<AppEnv>): Promise<Response> {
  const caller = callerOf(c);
  if (caller instanceof Response) return caller;
  const parsed = pushUnsubscribeSchema.safeParse(await readJson(c));
  if (!parsed.success) return refuse(c, 'malformed_command');
  await pushStore(caller.db).unsubscribe(caller.personId, parsed.data.endpoint);
  return accepted(c);
}

export function pushRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/key', handleKey);
  routes.post('/subscriptions', handleSubscribe);
  routes.post('/subscriptions/remove', handleUnsubscribe);
  return routes;
}

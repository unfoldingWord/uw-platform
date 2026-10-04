import type { Context } from 'hono';
import { z } from 'zod';
import { liveScreenSchema, type Principal } from '@uw/contracts';
import type { Caller } from '@uw/harness';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { platformKernel } from '../kernel.ts';

const harnessParam = z.uuid();
const HUB_CONNECT_URL = 'https://hub.internal/connect';
const UPGRADE_REQUIRED = 426;

const watchedSchema = z
  .strictObject({ screen: liveScreenSchema.nullable(), item: z.uuid().nullable() })
  .refine((watched) => (watched.screen === 'item') === (watched.item !== null));

type Watched = z.infer<typeof watchedSchema>;

function asksForSocket(c: Context<AppEnv>): boolean {
  return c.req.header('upgrade')?.toLowerCase() === 'websocket';
}

function watchedOf(c: Context<AppEnv>): Watched | null {
  const parsed = watchedSchema.safeParse({
    screen: c.req.query('screen') ?? null,
    item: c.req.query('item') ?? null,
  });
  return parsed.success ? parsed.data : null;
}

export function hubHeaders(
  actor: Principal,
  personId: string,
  watched: Watched,
): Record<string, string> {
  const headers: Record<string, string> = { Upgrade: 'websocket', 'x-hub-person': personId };
  if (actor.kind !== 'person' || watched.screen === null) return headers;
  headers['x-hub-screen'] = watched.screen;
  if (watched.item !== null) headers['x-hub-item'] = watched.item;
  return headers;
}

export async function connectLive(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (c.req.method !== 'GET') return refuse(c, 'malformed_command');
  if (!asksForSocket(c)) {
    c.set('outcome', 'malformed_command');
    return c.json({ status: 'error', reason: 'malformed_command' }, UPGRADE_REQUIRED);
  }
  const watched = watchedOf(c);
  if (watched === null) return refuse(c, 'malformed_command');
  const harness = harnessParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const scene = await kernel.reads.harness(caller, { harnessId: harness.data }, { at });
  if (scene.status !== 'accepted' || actor.personId === null) return refuse(c, 'harness_not_found');
  const namespace = c.env.HARNESS_HUB;
  if (namespace === undefined) return refuse(c, 'not_wired');
  c.set('outcome', 'accepted');
  const stub = namespace.get(namespace.idFromName(scene.value.harness.id));
  const headers = hubHeaders(actor, actor.personId, watched);
  return stub.fetch(HUB_CONNECT_URL, { method: 'GET', headers });
}

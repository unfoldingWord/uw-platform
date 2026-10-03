import type { Context } from 'hono';
import { z } from 'zod';
import type { Caller } from '@uw/harness';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { platformKernel } from '../kernel.ts';

const harnessParam = z.uuid();
const HUB_CONNECT_URL = 'https://hub.internal/connect';
const UPGRADE_REQUIRED = 426;

function asksForSocket(c: Context<AppEnv>): boolean {
  return c.req.header('upgrade')?.toLowerCase() === 'websocket';
}

export async function connectLive(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (!asksForSocket(c)) {
    c.set('outcome', 'malformed_command');
    return c.json({ status: 'error', reason: 'malformed_command' }, UPGRADE_REQUIRED);
  }
  const harness = harnessParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const scene = await kernel.reads.harness(caller, { harnessId: harness.data }, { at });
  if (scene.status !== 'accepted') return refuse(c, 'harness_not_found');
  const namespace = c.env.HARNESS_HUB;
  if (namespace === undefined) return refuse(c, 'not_wired');
  c.set('outcome', 'accepted');
  const stub = namespace.get(namespace.idFromName(scene.value.harness.id));
  return stub.fetch(HUB_CONNECT_URL, { method: 'GET', headers: { Upgrade: 'websocket' } });
}

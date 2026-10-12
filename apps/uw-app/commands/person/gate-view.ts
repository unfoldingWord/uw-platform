import type { Context } from 'hono';
import { z } from 'zod';
import { gateViewSchema } from '@uw/contracts';
import type { Caller } from '@uw/harness';
import type { AppEnv } from '../../deps.ts';
import { refuse } from '../../http/outcomes.ts';
import { platformKernel } from '../../kernel.ts';

const idParam = z.uuid();

export async function gateView(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const harness = idParam.safeParse(c.req.param('harness'));
  const item = idParam.safeParse(c.req.param('item'));
  if (!harness.success || !item.success) return refuse(c, 'item_not_found');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const itemId = item.data;
  const scene = await kernel.reads.item(caller, { itemId }, { at });
  if (scene.status !== 'accepted' || scene.value.harness.id !== harness.data) {
    return refuse(c, 'item_not_found');
  }
  const view = await kernel.gates.view(caller, { itemId }, { at });
  if (view.status !== 'accepted') return refuse(c, view.reason);
  return c.json(gateViewSchema.parse(view.value));
}

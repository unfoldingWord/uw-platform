import type { Context } from 'hono';
import { z } from 'zod';
import { itemStateSchema, stageKeySchema } from '@uw/contracts';
import type { Caller, Clock } from '@uw/harness';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { platformKernel } from '../kernel.ts';

const harnessParam = z.uuid();
const noStage = '';

export async function stageItems(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const harness = harnessParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const stage = stageKeySchema.safeParse(c.req.param('stage'));
  const at = c.get('now');
  const clock: Clock = { now: () => at };
  const kernel = platformKernel(database, clock);
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const input = { harnessId: harness.data, stageKey: stage.success ? stage.data : noStage };
  const read = await kernel.reads.inStage(caller, input, { at });
  if (read.status !== 'accepted') return refuse(c, read.reason);
  return c.json({ items: read.value.map((item) => itemStateSchema.parse(item)) });
}

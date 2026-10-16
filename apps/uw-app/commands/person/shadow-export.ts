import type { Context } from 'hono';
import { z } from 'zod';
import { shadowComparisonSchema } from '@uw/contracts';
import type { Caller } from '@uw/harness';
import type { AppEnv } from '../../deps.ts';
import { refuse } from '../../http/outcomes.ts';
import { platformKernel } from '../../kernel.ts';

const idParam = z.uuid();

export async function shadowExport(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const harness = idParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const view = await kernel.views.shadow(caller, { harnessId: harness.data }, { at });
  if (view.status !== 'accepted') return refuse(c, view.reason);
  const body = shadowComparisonSchema.parse(view.value);
  c.header('content-disposition', `attachment; filename="shadow-${body.harnessKey}.json"`);
  return c.json(body);
}

import type { Context } from 'hono';
import { z } from 'zod';
import { draftCheckSchema } from '@uw/contracts';
import type { Caller } from '@uw/harness';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { platformKernel } from '../kernel.ts';

const harnessParam = z.uuid();

export async function draftCheck(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const harness = harnessParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const read = await kernel.views.workflowDraft(caller, { harnessId: harness.data }, { at });
  if (read.status !== 'accepted') return refuse(c, read.reason);
  const draft = read.value;
  if (draft === null || !draft.admin) return refuse(c, 'draft_not_found');
  return c.json(draftCheckSchema.parse({ revision: draft.revision, problems: draft.problems }));
}

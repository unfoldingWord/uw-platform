import { Hono, type Context } from 'hono';
import {
  addCommitmentCommandSchema,
  removeCommitmentCommandSchema,
  removeStaffAllocationCommandSchema,
  setStaffAllocationCommandSchema,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { ZodType } from 'zod';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import {
  addCommitment,
  removeCommitment,
  removeStaffAllocation,
  setStaffAllocation,
  type TeamWrite,
} from './team-writes.ts';

type Ran = { readonly requestId: string; readonly result: CommandResult } | null;
type Run = (db: Database, body: unknown, write: TeamWrite) => Promise<Ran>;

function command<C extends { readonly requestId: string }>(
  schema: ZodType<C>,
  write: (db: Database, command: C, write: TeamWrite) => Promise<CommandResult>,
): Run {
  return async (db, body, by) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return null;
    return { requestId: parsed.data.requestId, result: await write(db, parsed.data, by) };
  };
}

const handlers = new Map<string, Run>([
  ['add_commitment', command(addCommitmentCommandSchema, addCommitment)],
  ['remove_commitment', command(removeCommitmentCommandSchema, removeCommitment)],
  ['set_staff_allocation', command(setStaffAllocationCommandSchema, setStaffAllocation)],
  ['remove_staff_allocation', command(removeStaffAllocationCommandSchema, removeStaffAllocation)],
]);

async function handleCommand(c: Context<AppEnv>): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor: Principal | null = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const ran = await run(database.db, body, { actor, at: c.get('now') });
  if (ran === null) return malformed(c, body);
  return reply(c, toOutcome(ran.requestId, ran.result));
}

export function teamRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handleCommand);
  return routes;
}

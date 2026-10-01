import { Hono, type Context } from 'hono';
import {
  grantRoleCommandSchema,
  revokeRoleCommandSchema,
  type GrantRoleCommand,
  type RevokeRoleCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { grantRole, revokeRole } from './grant-commands.ts';

type Run = (
  db: Database,
  actor: Principal,
  body: unknown,
  traceId: string,
) => Promise<{ readonly requestId: string; readonly result: CommandResult } | null>;

const handlers = new Map<string, Run>([
  [
    'grant_role',
    async (db, actor, body, traceId) => {
      const parsed = grantRoleCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: GrantRoleCommand = parsed.data;
      return { requestId: command.requestId, result: await grantRole(db, actor, command, traceId) };
    },
  ],
  [
    'revoke_role',
    async (db, actor, body, traceId) => {
      const parsed = revokeRoleCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: RevokeRoleCommand = parsed.data;
      return {
        requestId: command.requestId,
        result: await revokeRole(db, actor, command, traceId),
      };
    },
  ],
]);

async function handle(c: Context<AppEnv>): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const outcome = await run(database.db, actor, body, c.get('traceId'));
  if (outcome === null) return malformed(c, body);
  return reply(c, toOutcome(outcome.requestId, outcome.result));
}

export function aclRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handle);
  return routes;
}

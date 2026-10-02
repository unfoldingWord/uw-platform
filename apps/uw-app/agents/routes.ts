import { Hono, type Context } from 'hono';
import {
  bindServiceTokenCommandSchema,
  revokeServiceTokenCommandSchema,
  type BindServiceTokenCommand,
  type RevokeServiceTokenCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { bindServiceToken, revokeServiceToken } from './service-tokens.ts';

type Run = (
  db: Database,
  actor: Principal,
  body: unknown,
  traceId: string,
  at: Date,
) => Promise<{ readonly requestId: string; readonly result: CommandResult } | null>;

const handlers = new Map<string, Run>([
  [
    'bind_service_token',
    async (db, actor, body, traceId, at) => {
      const parsed = bindServiceTokenCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: BindServiceTokenCommand = parsed.data;
      const result = await bindServiceToken(db, actor, command, traceId, at);
      return { requestId: command.requestId, result };
    },
  ],
  [
    'revoke_service_token',
    async (db, actor, body, _traceId, at) => {
      const parsed = revokeServiceTokenCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: RevokeServiceTokenCommand = parsed.data;
      const result = await revokeServiceToken(db, actor, command, at);
      return { requestId: command.requestId, result };
    },
  ],
]);

async function handleCommand(c: Context<AppEnv>): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const outcome = await run(database.db, actor, body, c.get('traceId'), c.get('now'));
  if (outcome === null) return malformed(c, body);
  return reply(c, toOutcome(outcome.requestId, outcome.result));
}

export function agentRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handleCommand);
  return routes;
}

import { Hono, type Context } from 'hono';
import {
  bindServiceTokenCommandSchema,
  revokeServiceTokenCommandSchema,
  routineChangeCommandSchema,
  type BindServiceTokenCommand,
  type RevokeServiceTokenCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { AppDeps, AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { applyRoutineChange, loginRemover } from './routine-actions.ts';
import { bindServiceToken, revokeServiceToken, type RemoveLogin } from './service-tokens.ts';

type RunRequest = {
  readonly db: Database;
  readonly actor: Principal;
  readonly body: unknown;
  readonly traceId: string;
  readonly at: Date;
  readonly removeLogin: RemoveLogin;
};

type Run = (
  request: RunRequest,
) => Promise<{ readonly requestId: string; readonly result: CommandResult } | null>;

const handlers = new Map<string, Run>([
  [
    'bind_service_token',
    async ({ db, actor, body, traceId, at }) => {
      const parsed = bindServiceTokenCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: BindServiceTokenCommand = parsed.data;
      const result = await bindServiceToken(db, actor, command, traceId, at);
      return { requestId: command.requestId, result };
    },
  ],
  [
    'revoke_service_token',
    async ({ db, actor, body, at, removeLogin }) => {
      const parsed = revokeServiceTokenCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: RevokeServiceTokenCommand = parsed.data;
      const result = await revokeServiceToken(db, actor, command, at, removeLogin);
      return { requestId: command.requestId, result };
    },
  ],
]);

const routineChanges = new Set(['pause_routine', 'resume_routine', 'revoke_routine']);

async function handleRoutineChange(c: Context<AppEnv>, deps: AppDeps): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const parsed = routineChangeCommandSchema.safeParse(body);
  if (!parsed.success) return malformed(c, body);
  const command = parsed.data;
  const request = { db: database.db, env: c.env, fetch: deps.fetch, actor, at: c.get('now') };
  const outcome = await applyRoutineChange(request, command.routineId, command.command);
  const result: CommandResult = outcome.ok ? { ok: true } : outcome;
  return reply(c, toOutcome(command.requestId, result));
}

async function handleCommand(c: Context<AppEnv>, deps: AppDeps): Promise<Response> {
  if (routineChanges.has(c.req.param('name') ?? '')) return handleRoutineChange(c, deps);
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const outcome = await run({
    db: database.db,
    actor,
    body,
    traceId: c.get('traceId'),
    at: c.get('now'),
    removeLogin: loginRemover(c.env, deps.fetch),
  });
  if (outcome === null) return malformed(c, body);
  return reply(c, toOutcome(outcome.requestId, outcome.result));
}

export function agentRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', (c) => handleCommand(c, deps));
  return routes;
}

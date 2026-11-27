import { Hono, type Context } from 'hono';
import type { ZodType } from 'zod';
import {
  customiseAssistantCommandSchema,
  deleteMyAssistantHistoryCommandSchema,
  disableAssistantCommandSchema,
  enableAssistantCommandSchema,
  grantAssistCommandSchema,
  renewAssistCommandSchema,
  revokeAssistCommandSchema,
  undoAssistantEffectCommandSchema,
} from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import {
  disableAssistant,
  enableAssistant,
  grantAssist,
  type AssistantCommandDeps,
} from './person/assistant.ts';
import {
  customiseAssistant,
  deleteMyAssistantHistory,
  renewAssist,
  revokeAssist,
  undoAssistantEffect,
} from './person/assistant-screen.ts';
import { assistantCommandDepsOf, type AssistantCommandHost } from './assistant-deps.ts';

type Host = Omit<AssistantCommandHost, 'requestId'>;
type Handler = {
  readonly schema: ZodType<{ readonly requestId: string }>;
  readonly run: (deps: AssistantCommandDeps, command: never) => Promise<CommandResult>;
};

function handler<T extends { readonly requestId: string }>(
  schema: ZodType<T>,
  run: (deps: AssistantCommandDeps, command: T) => Promise<CommandResult>,
): Handler {
  return { schema, run: run as Handler['run'] };
}

const handlers = new Map<string, Handler>([
  ['enable_assistant', handler(enableAssistantCommandSchema, enableAssistant)],
  ['disable_assistant', handler(disableAssistantCommandSchema, disableAssistant)],
  ['grant_assist', handler(grantAssistCommandSchema, grantAssist)],
  ['customise_assistant', handler(customiseAssistantCommandSchema, customiseAssistant)],
  ['renew_assist', handler(renewAssistCommandSchema, renewAssist)],
  ['revoke_assist', handler(revokeAssistCommandSchema, revokeAssist)],
  ['undo_assistant_effect', handler(undoAssistantEffectCommandSchema, undoAssistantEffect)],
  [
    'delete_my_assistant_history',
    handler(deleteMyAssistantHistoryCommandSchema, deleteMyAssistantHistory),
  ],
]);

async function run(entry: Handler, host: Host, body: unknown) {
  const parsed = entry.schema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId } = parsed.data;
  const deps = assistantCommandDepsOf({ ...host, requestId });
  return { requestId, result: await entry.run(deps, parsed.data as never) };
}

function handle(fetcher: typeof fetch) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const entry = handlers.get(c.req.param('name') ?? '');
    if (!entry) return refuse(c, 'not_wired');
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    const actor = c.get('principal');
    if (actor === null) return refuse(c, 'unauthenticated');
    if (actor.kind !== 'person' || actor.personId === null) return refuse(c, 'not_permitted');
    const body = await readJson(c);
    const host = {
      env: c.env,
      database,
      fetch: fetcher,
      actor,
      traceId: c.get('traceId'),
      at: c.get('now'),
    };
    const outcome = await run(entry, host, body);
    if (outcome === null) return malformed(c, body);
    return reply(c, toOutcome(outcome.requestId, outcome.result));
  };
}

export function assistantRoutes(fetcher: typeof fetch): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handle(fetcher));
  return routes;
}

import { Hono, type Context } from 'hono';
import {
  disableAssistantCommandSchema,
  enableAssistantCommandSchema,
  grantAssistCommandSchema,
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
import { assistantCommandDepsOf, type AssistantCommandHost } from './assistant-deps.ts';

type Host = Omit<AssistantCommandHost, 'requestId'>;
type Run = (
  host: Host,
  body: unknown,
) => Promise<{ readonly requestId: string; readonly result: CommandResult } | null>;

function depsOf(host: Host, requestId: string): AssistantCommandDeps {
  return assistantCommandDepsOf({ ...host, requestId });
}

const handlers = new Map<string, Run>([
  [
    'enable_assistant',
    async (host, body) => {
      const parsed = enableAssistantCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      return {
        requestId: parsed.data.requestId,
        result: await enableAssistant(depsOf(host, parsed.data.requestId), parsed.data),
      };
    },
  ],
  [
    'disable_assistant',
    async (host, body) => {
      const parsed = disableAssistantCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      return {
        requestId: parsed.data.requestId,
        result: await disableAssistant(depsOf(host, parsed.data.requestId)),
      };
    },
  ],
  [
    'grant_assist',
    async (host, body) => {
      const parsed = grantAssistCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      return {
        requestId: parsed.data.requestId,
        result: await grantAssist(depsOf(host, parsed.data.requestId), parsed.data),
      };
    },
  ],
]);

function handle(fetcher: typeof fetch) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const run = handlers.get(c.req.param('name') ?? '');
    if (!run) return refuse(c, 'not_wired');
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    const actor = c.get('principal');
    if (actor === null) return refuse(c, 'unauthenticated');
    const body = await readJson(c);
    const host = {
      env: c.env,
      database,
      fetch: fetcher,
      actor,
      traceId: c.get('traceId'),
      at: c.get('now'),
    };
    const outcome = await run(host, body);
    if (outcome === null) return malformed(c, body);
    return reply(c, toOutcome(outcome.requestId, outcome.result));
  };
}

export function assistantRoutes(fetcher: typeof fetch): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handle(fetcher));
  return routes;
}

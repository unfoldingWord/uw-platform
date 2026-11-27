import { Hono, type Context } from 'hono';
import {
  approvePersonCommandSchema,
  deactivatePersonCommandSchema,
  declinePersonCommandSchema,
  disablePersonAssistantCommandSchema,
  grantRoleCommandSchema,
  revokeRoleCommandSchema,
  saveProfileBodyCommandSchema,
  setAssistantBudgetCommandSchema,
  type GrantRoleCommand,
  type RevokeRoleCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { setAssistantBudget } from '../assistants/budget-command.ts';
import { disablePersonAssistant } from '../assistants/turn-off-command.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { approvePerson, deactivatePerson, declinePerson } from '../people/approval.ts';
import { saveProfileBody } from '../people/profile-body.ts';
import { accessScreen } from '../views/screens/access.tsx';
import { grantRole, revokeRole } from './grant-commands.ts';

type Run = (
  db: Database,
  actor: Principal,
  body: unknown,
  traceId: string,
  at: Date,
) => Promise<{ readonly requestId: string; readonly result: CommandResult } | null>;

const handlers = new Map<string, Run>([
  [
    'grant_role',
    async (db, actor, body, traceId, at) => {
      const parsed = grantRoleCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: GrantRoleCommand = parsed.data;
      const result = await grantRole(db, actor, command, traceId, at);
      return { requestId: command.requestId, result };
    },
  ],
  [
    'revoke_role',
    async (db, actor, body, traceId, at) => {
      const parsed = revokeRoleCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: RevokeRoleCommand = parsed.data;
      const result = await revokeRole(db, actor, command, traceId, at);
      return { requestId: command.requestId, result };
    },
  ],
  [
    'approve_person',
    async (db, actor, body, traceId, at) => {
      const parsed = approvePersonCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await approvePerson(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'decline_person',
    async (db, actor, body, traceId, at) => {
      const parsed = declinePersonCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await declinePerson(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'deactivate_person',
    async (db, actor, body, traceId, at) => {
      const parsed = deactivatePersonCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await deactivatePerson(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'save_profile_body',
    async (db, actor, body, traceId, at) => {
      const parsed = saveProfileBodyCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await saveProfileBody(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'set_assistant_budget',
    async (db, actor, body, traceId, at) => {
      const parsed = setAssistantBudgetCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await setAssistantBudget(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'disable_person_assistant',
    async (db, actor, body, traceId, at) => {
      const parsed = disablePersonAssistantCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await disablePersonAssistant(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
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
  const outcome = await run(database.db, actor, body, c.get('traceId'), c.get('now'));
  if (outcome === null) return malformed(c, body);
  return reply(c, toOutcome(outcome.requestId, outcome.result));
}

export function aclRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handle);
  return routes;
}

export function directoryScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/access', accessScreen);
  return routes;
}

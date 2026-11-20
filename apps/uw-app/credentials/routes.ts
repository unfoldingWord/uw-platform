import { Hono, type Context } from 'hono';
import {
  bindCredentialCommandSchema,
  confirmRevealCommandSchema,
  createCredentialCommandSchema,
  grantRevealCommandSchema,
  revealCredentialCommandSchema,
  revokeCredentialCommandSchema,
  revokeRevealCommandSchema,
  rotateCredentialCommandSchema,
  unbindCredentialCommandSchema,
  type CredentialRevealed,
  type ErrorReason,
  type Principal,
} from '@uw/contracts';
import type { AppDeps, AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { notifyConfigOf } from '../notify/config.ts';
import { webPushTransport } from '../notify/push/transport.ts';
import { requestLogger } from '../request-logger.ts';
import { credentialScreen } from '../views/screens/credential.tsx';
import { credentialsScreen } from '../views/screens/credentials.tsx';
import { utf8 } from './base64.ts';
import { bindCredential, unbindCredential } from './bindings.ts';
import { credentialsDepsOf } from './compose.ts';
import { revealCredential, type RevealDeps } from './reveal.ts';
import { confirmRevealGrant, giveRevealGrant, revokeRevealGrant } from './reveal-grants.ts';
import { revokeCredential } from './revoke.ts';
import { createCredential, rotateCredential, type StoreRefusal } from './store.ts';
import { tellAreaAdmins } from './tell-admins.ts';

type Platform = Pick<AppDeps, 'fetch' | 'timers' | 'clock' | 'newId'>;

type Answered = { readonly ok: true } | { readonly ok: false; readonly reason: StoreRefusal };

type Ran = { readonly requestId: string; readonly answered: Answered } | null;

type Run = (deps: RevealDeps, actor: Principal, body: unknown, traceId: string) => Promise<Ran>;

function reasonOf(refusal: StoreRefusal): ErrorReason {
  if (refusal === 'workflow_not_found') return 'harness_not_found';
  return refusal === 'credential_malformed' ? 'malformed_command' : refusal;
}

function resultOf(answered: Answered): CommandResult {
  return answered.ok ? { ok: true } : { ok: false, reason: reasonOf(answered.reason) };
}

function instant(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

const create: Run = async (deps, actor, body, traceId) => {
  const parsed = createCredentialCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, jdArea, jdRef, name, kind, ownerId, rotateBy } = parsed.data;
  const placed = { jdArea, jdRef, name, kind, ownerId, rotateBy };
  const sealed = { expiresAt: instant(parsed.data.expiresAt), value: utf8(parsed.data.value) };
  const input = { ...placed, ...sealed };
  return { requestId, answered: await createCredential(deps, actor, input, traceId) };
};

const rotate: Run = async (deps, actor, body, traceId) => {
  const parsed = rotateCredentialCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, credentialId, rotateBy, expiresAt, value } = parsed.data;
  const rotation = { credentialId, rotateBy, expiresAt: instant(expiresAt), value: utf8(value) };
  return { requestId, answered: await rotateCredential(deps, actor, rotation, traceId) };
};

const revoke: Run = async (deps, actor, body, traceId) => {
  const parsed = revokeCredentialCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, credentialId } = parsed.data;
  return { requestId, answered: await revokeCredential(deps, actor, credentialId, traceId) };
};

const bind: Run = async (deps, actor, body, traceId) => {
  const parsed = bindCredentialCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, credentialId, harnessId, connectorKey } = parsed.data;
  const binding = { credentialId, harnessId, connectorKey };
  return { requestId, answered: await bindCredential(deps, actor, binding, traceId) };
};

const unbind: Run = async (deps, actor, body, traceId) => {
  const parsed = unbindCredentialCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, credentialId, harnessId, connectorKey } = parsed.data;
  const binding = { credentialId, harnessId, connectorKey };
  return { requestId, answered: await unbindCredential(deps, actor, binding, traceId) };
};

const grantReveal: Run = async (deps, actor, body, traceId) => {
  const parsed = grantRevealCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, credentialId, personId, minutes } = parsed.data;
  const request = { credentialId, personId, minutes };
  return { requestId, answered: await giveRevealGrant(deps, actor, request, traceId) };
};

const confirmReveal: Run = async (deps, actor, body, traceId) => {
  const parsed = confirmRevealCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, grantId } = parsed.data;
  return { requestId, answered: await confirmRevealGrant(deps, actor, grantId, traceId) };
};

const revokeReveal: Run = async (deps, actor, body, traceId) => {
  const parsed = revokeRevealCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, grantId } = parsed.data;
  return { requestId, answered: await revokeRevealGrant(deps, actor, grantId, traceId) };
};

const handlers = new Map<string, Run>([
  ['create_credential', create],
  ['rotate_credential', rotate],
  ['revoke_credential', revoke],
  ['bind_credential', bind],
  ['unbind_credential', unbind],
  ['grant_reveal', grantReveal],
  ['confirm_reveal', confirmReveal],
  ['revoke_reveal', revokeReveal],
]);

type Asking = { readonly deps: RevealDeps; readonly actor: Principal };

function askingOf(c: Context<AppEnv>, platform: Platform): Asking | Response {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (actor.kind !== 'person' || !actor.interactive) return refuse(c, 'not_permitted');
  const push = notifyConfigOf(c.env).push;
  const transport = push === null ? null : webPushTransport(push, platform.fetch, platform.timers);
  const tell = tellAreaAdmins({ db: database.db, transport, logger: requestLogger(c) });
  return { deps: { ...credentialsDepsOf(c.env, database.db, platform), tell }, actor };
}

async function handleCommand(c: Context<AppEnv>, platform: Platform): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const asking = askingOf(c, platform);
  if (asking instanceof Response) return asking;
  const body = await readJson(c);
  const ran = await run(asking.deps, asking.actor, body, c.get('traceId'));
  if (ran === null) return malformed(c, body);
  return reply(c, toOutcome(ran.requestId, resultOf(ran.answered)));
}

async function handleReveal(c: Context<AppEnv>, platform: Platform): Promise<Response> {
  c.header('cache-control', 'no-store');
  c.header('pragma', 'no-cache');
  const asking = askingOf(c, platform);
  if (asking instanceof Response) return asking;
  const body = await readJson(c);
  const parsed = revealCredentialCommandSchema.safeParse(body);
  if (!parsed.success) return malformed(c, body);
  const { requestId, credentialId } = parsed.data;
  const revealed = await revealCredential(
    asking.deps,
    asking.actor,
    credentialId,
    c.get('traceId'),
  );
  if (!revealed.ok) return reply(c, toOutcome(requestId, resultOf(revealed)));
  const answer: CredentialRevealed = { status: 'accepted', requestId, value: revealed.value };
  c.set('outcome', 'accepted');
  return c.json(answer, 200);
}

export function credentialRoutes(platform: Platform): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', (c) => handleCommand(c, platform));
  routes.post('/reveal', (c) => handleReveal(c, platform));
  return routes;
}

export function credentialScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', credentialsScreen);
  routes.get('/:credentialId', credentialScreen);
  return routes;
}

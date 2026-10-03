import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { delegatedIdentity, identitySchema, principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { harnessRoutes } from '../commands/routes.ts';
import { noGateGitHub } from '../commands/person-deps.ts';
import type { AppEnv } from '../deps.ts';
import { systemClock } from '../ports/clock.ts';
import { accepted, callerOf, type Sent } from './commands.ts';
import { agentOf, kernelOn } from './kernel.ts';

type AgentForms = {
  readonly readable: readonly Principal[];
  readonly hidden: readonly Principal[];
};

export async function readAs(db: Database, principal: Principal, path: string): Promise<Sent> {
  const app = new Hono<AppEnv>();
  const traceId = randomUUID();
  app.use(async (c, next) => {
    c.set('database', { db, ping: async () => undefined, release: async () => undefined });
    c.set('principal', principal);
    c.set('now', new Date());
    c.set('traceId', traceId);
    c.set('outcome', null);
    await next();
  });
  app.route('/api/harness', harnessRoutes({ clock: systemClock }, noGateGitHub));
  const raw = await app.request(path, { method: 'GET' });
  const text = await raw.text();
  const body = JSON.parse(text) as Record<string, unknown>;
  return { status: raw.status, body, text, traceId };
}

function agent(identity: string, owner: Principal, personId: string | null, interactive: boolean) {
  return principalSchema.parse({
    identity,
    kind: 'agent',
    personId,
    email: null,
    grants: owner.grants,
    interactive,
  });
}

export async function agentForms(
  db: Database,
  owner: Principal,
  harnessId: string,
): Promise<AgentForms> {
  const kernel = kernelOn(db, { now: () => new Date() });
  const delegation = accepted(
    await kernel.delegations.grant(callerOf(owner), {
      harnessId,
      persona: 'agent:builder',
      capability: 'iterate',
      expiresAt: null,
      supersedes: null,
    }),
  );
  const device = `agent:${owner.personId}/laptop`;
  const lapsed = delegatedIdentity(device, 'builder', randomUUID());
  return {
    readable: [
      agentOf(owner, 'laptop'),
      agent('agent:builder', owner, owner.personId, false),
      agent(delegatedIdentity(device, 'builder', delegation.id), owner, owner.personId, false),
    ],
    hidden: [
      agent('agent:system', { ...owner, grants: [] }, null, false),
      agent('agent:ingest', owner, null, false),
      agent('agent:reviewer', owner, owner.personId, false),
      agent(`agent:${owner.personId}/runner`, owner, owner.personId, false),
      agent(lapsed, owner, owner.personId, false),
      {
        ...owner,
        identity: identitySchema.parse(`agent:${randomUUID()}/laptop`),
        kind: 'agent',
        email: null,
      },
      { ...agentOf(owner, 'laptop'), grants: [] },
    ],
  };
}

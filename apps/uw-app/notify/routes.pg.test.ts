import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { serviceTokenPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import type { AppEnv } from '../deps.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { pushRoutes } from './routes.ts';
import { endpointFor, subscription, vapidFixture, type VapidFixture } from './testing.ts';

const ANA = 'push-route-ana@unfoldingword.org';
const BEN = 'push-route-ben@unfoldingword.org';

let access: AccessFixture;
let vapid: VapidFixture;

beforeAll(async () => {
  access = await createAccessFixture();
  vapid = await vapidFixture();
});

type Sent = { readonly status: number; readonly body: Record<string, unknown> };

async function send(
  db: Database,
  claims: Record<string, unknown>,
  path: string,
  body?: unknown,
  env: Record<string, string> = vapid.env,
): Promise<Sent> {
  const token = await access.sign(claims);
  const headers: Record<string, string> = { 'cf-access-jwt-assertion': token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const raw = await createApp(postgresDeps(db, access)).request(
    `/api/push${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...fixtureAccessEnv, ...env },
  );
  return { status: raw.status, body: (await raw.json()) as Record<string, unknown> };
}

async function endpoints(db: Database): Promise<{ endpoint: string; email: string }[]> {
  const rows = await db.execute<{ endpoint: string; email: string }>(
    sql`SELECT s.endpoint, p.email FROM push_subscriptions s JOIN people p ON p.id = s.person_id ORDER BY s.endpoint`,
  );
  return [...rows];
}

const notPushServices = [
  'https://169.254.169.254/latest/meta-data',
  'http://fcm.googleapis.com/fcm/send/x',
  'https://evil.example/fcm.googleapis.com',
  'not a url',
];

async function subscribesAndUnsubscribes(db: Database): Promise<void> {
  const key = await send(db, { email: ANA }, '/key');
  expect(key).toEqual({
    status: 200,
    body: { status: 'accepted', publicKey: vapid.config.publicKey },
  });
  const device = await subscription(endpointFor('ana-phone'));
  const added = await send(db, { email: ANA }, '/subscriptions', device);
  expect(added.body).toEqual({ status: 'accepted' });
  expect(await endpoints(db)).toEqual([{ endpoint: device.endpoint, email: ANA }]);
  const remove = { endpoint: device.endpoint };
  const byOther = await send(db, { email: BEN }, '/subscriptions/remove', remove);
  expect(byOther.body).toEqual({ status: 'accepted' });
  expect(await endpoints(db)).toHaveLength(1);
  await send(db, { email: ANA }, '/subscriptions/remove', remove);
  expect(await endpoints(db)).toEqual([]);
}

async function refusesStrangeEndpoints(db: Database): Promise<void> {
  const keys = (await subscription(endpointFor('x'))).keys;
  for (const endpoint of notPushServices) {
    const body = { endpoint, keys, expirationTime: null };
    expect(await send(db, { email: ANA }, '/subscriptions', body)).toEqual({
      status: 400,
      body: { status: 'error', reason: 'malformed_command' },
    });
  }
  expect(await endpoints(db)).toEqual([]);
}

function agentApp(db: Database, principal: Principal): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set('database', { db, ping: async () => undefined, release: async () => undefined });
    c.set('principal', principal);
    c.set('now', new Date('2026-10-04T09:00:00.000Z'));
    await next();
  });
  app.route('/api/push', pushRoutes());
  return app;
}

async function refusesAgents(db: Database): Promise<void> {
  const token = await send(db, { common_name: 'svc-push' }, '/key');
  expect(token.body).toEqual({ status: 'error', reason: 'unauthenticated' });
  const device = await subscription(endpointFor('agent'));
  const deviceAgent = principalSchema.parse({
    identity: 'agent:c9000000-0000-4000-8000-000000000001/laptop',
    kind: 'agent',
    personId: 'c9000000-0000-4000-8000-000000000001',
    email: null,
    grants: [],
    interactive: true,
  });
  for (const principal of [serviceTokenPrincipal('svc-push'), deviceAgent]) {
    const answer = await agentApp(db, principal).request(
      '/api/push/subscriptions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(device),
      },
      vapid.env,
    );
    expect({ status: answer.status, body: await answer.json() }).toEqual({
      status: 403,
      body: { status: 'error', reason: 'not_permitted' },
    });
  }
  expect(await endpoints(db)).toEqual([]);
}

async function keyNotWired(db: Database): Promise<void> {
  const sent = await send(db, { email: ANA }, '/key', undefined, {});
  expect(sent.body).toEqual({ status: 'error', reason: 'not_wired' });
}

describe.skipIf(!testServer)('the push routes', () => {
  it('a person subscribes and unsubscribes a device through the push routes', () =>
    withAppDatabase(subscribesAndUnsubscribes));

  it('refuses an endpoint that is not a push service, or is not a URL, as malformed_command', () =>
    withAppDatabase(refusesStrangeEndpoints));

  it('answers not_wired for the key with no VAPID configuration', () =>
    withAppDatabase(keyNotWired));

  it('refuses a service token at the edge, and in the route an agent principal, a device agent with a person included', () =>
    withAppDatabase(refusesAgents));
});

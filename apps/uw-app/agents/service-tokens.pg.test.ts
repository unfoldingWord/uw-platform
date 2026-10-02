import { randomUUID } from 'node:crypto';
import { getTableName, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import { serviceTokens } from '@uw/db/schema';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { createApp } from '../app.tsx';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { agentOf, personOn } from '../testing/kernel.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { bindServiceToken, liveBinding, owns, revokeServiceToken } from './service-tokens.ts';

const IAN = 'ian.lindsley@unfoldingword.org';
const IAN_ID = '00000000-0000-4000-8000-000000000001';
const IAN_GRANT_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT = 'routine-1.access';
const DEVICE = 'hourly-routine';
const AREA = '80-89';
const granted = new Date('2026-10-01T00:00:00.000Z');
const at = new Date('2026-10-02T12:00:00.000Z');

const people = {
  editor: { n: 1, email: 'tok-editor@unfoldingword.org', role: 'editor', status: 'active' },
  areaAdmin: { n: 2, email: 'tok-area-admin@unfoldingword.org', role: 'admin', status: 'active' },
  viewer: { n: 3, email: 'tok-viewer@unfoldingword.org', role: 'viewer', status: 'active' },
  pending: { n: 4, email: 'tok-pending@unfoldingword.org', role: 'editor', status: 'pending' },
} as const;

type Who = keyof typeof people;
type Sent = { readonly status: number; readonly body: Record<string, unknown> };

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

function idOf(who: Who): string {
  return `00000000-0000-4000-8000-0000000008${String(people[who].n).padStart(2, '0')}`;
}

async function seedPeople(db: Database): Promise<void> {
  for (const who of Object.keys(people) as Who[]) {
    const spec = people[who];
    await seedPerson(db, { id: idOf(who), email: spec.email, status: spec.status });
    await seedGrant(db, {
      id: `00000000-0000-4000-8000-0000000018${String(spec.n).padStart(2, '0')}`,
      personId: idOf(who),
      role: spec.role,
      scopeKind: 'jd_area',
      scopeArea: AREA,
      grantedAt: granted,
      expiresAt: null,
    });
  }
}

async function send(db: Database, claims: Record<string, unknown>, body: unknown): Promise<Sent> {
  const token = await fixture.sign(claims);
  const name = (body as { command?: string }).command ?? 'bind_service_token';
  const raw = await createApp(postgresDeps(db, fixture)).request(
    `/api/agents/commands/${name}`,
    {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    fixtureAccessEnv,
  );
  return { status: raw.status, body: (await raw.json()) as Record<string, unknown> };
}

function bindBody(personId: string, clientId = CLIENT, device = DEVICE) {
  return { command: 'bind_service_token', requestId: randomUUID(), clientId, personId, device };
}

function revokeBody(clientId = CLIENT) {
  return { command: 'revoke_service_token', requestId: randomUUID(), clientId };
}

function asIan(db: Database, body: unknown): Promise<Sent> {
  return send(db, { email: IAN }, body);
}

function outcomeOf(sent: Sent): unknown {
  return sent.body['status'] === 'accepted' ? 'accepted' : sent.body['reason'];
}

function withPeople(work: (db: Database) => Promise<void>): Promise<void> {
  return withAppDatabase(async (db) => {
    await seedPeople(db);
    await work(db);
  });
}

async function storedRow(db: Database) {
  const rows = await db.execute<{ bound_by: string; trace_id: string; revoked_at: unknown }>(
    sql`SELECT bound_by, trace_id, revoked_at FROM service_tokens WHERE client_id = ${CLIENT}`,
  );
  return rows[0];
}

async function expiringOrgAdmin(db: Database) {
  const id = '00000000-0000-4000-8000-000000000890';
  const email = 'tok-expiring@unfoldingword.org';
  await seedPerson(db, { id, email });
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000001890',
    personId: id,
    role: 'admin',
    scopeKind: 'org',
    scopeArea: null,
    grantedAt: granted,
    expiresAt: new Date('2026-10-02T06:00:00.000Z'),
  });
  return personOn(db, id, email, granted);
}

async function racingBinds(ian: Principal, dbA: Database, dbB: Database, n: number) {
  const clientId = `race${n}-${randomUUID().slice(0, 8)}.access`;
  const bind = (device: string) => ({
    command: 'bind_service_token' as const,
    requestId: randomUUID(),
    clientId,
    personId: idOf('editor'),
    device,
  });
  const results = await Promise.all([
    bindServiceToken(dbA, ian, bind(`a${n}`), randomUUID(), at),
    bindServiceToken(dbB, ian, bind(`b${n}`), randomUUID(), at),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results).toContainEqual({ ok: false, reason: 'grant_exists' });
  expect(await liveBinding(dbA, clientId)).not.toBeNull();
}

async function onTwoConnections(work: (dbA: Database, dbB: Database) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const dbA = createClient(database.connectionString);
  const dbB = createClient(database.connectionString);
  try {
    await work(dbA, dbB);
  } finally {
    await dbA.$client.end();
    await dbB.$client.end();
    await database.drop();
  }
}

describe('service_tokens has one writer', () => {
  it('declares exactly service_tokens as owned', () => {
    expect(owns).toEqual([getTableName(serviceTokens)]);
  });
});

describe.skipIf(!testServer)("an org admin binds a service token to a person's device", () => {
  it('binds the token to the person and device, recording the org admin and trace', () =>
    withPeople(async (db) => {
      const sent = await asIan(db, bindBody(idOf('editor')));
      expect(sent.status).toBe(200);
      expect(outcomeOf(sent)).toBe('accepted');
      expect(await liveBinding(db, CLIENT)).toEqual({ personId: idOf('editor'), device: DEVICE });
      const row = await storedRow(db);
      expect(row?.bound_by).toBe(`human:${IAN_ID}`);
      expect(row?.trace_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row?.revoked_at).toBeNull();
    }));

  it('refuses the same token twice, and a second token for the same live device', () =>
    withPeople(async (db) => {
      await asIan(db, bindBody(idOf('editor')));
      expect(outcomeOf(await asIan(db, bindBody(idOf('editor'))))).toBe('grant_exists');
      const other = bindBody(idOf('editor'), 'routine-2.access');
      expect(outcomeOf(await asIan(db, other))).toBe('grant_exists');
      expect(await liveBinding(db, 'routine-2.access')).toBeNull();
    }));

  it('refuses an area admin who is not an org admin', () =>
    withPeople(async (db) => {
      const sent = await send(db, { email: people.areaAdmin.email }, bindBody(idOf('editor')));
      expect(outcomeOf(sent)).toBe('not_permitted');
      expect(await liveBinding(db, CLIENT)).toBeNull();
    }));

  it('refuses a target who holds only viewer, a pending target and an unknown person', () =>
    withPeople(async (db) => {
      expect(outcomeOf(await asIan(db, bindBody(idOf('viewer'))))).toBe('not_permitted');
      expect(outcomeOf(await asIan(db, bindBody(idOf('pending'))))).toBe('pending_approval');
      expect(outcomeOf(await asIan(db, bindBody(randomUUID())))).toBe('person_not_found');
      expect(await liveBinding(db, CLIENT)).toBeNull();
    }));

  it('refuses a target whose editor grant has been revoked', () =>
    withPeople(async (db) => {
      await revokeSeededGrant(db, '00000000-0000-4000-8000-000000001801', granted);
      expect(outcomeOf(await asIan(db, bindBody(idOf('editor'))))).toBe('not_permitted');
    }));
});

describe.skipIf(!testServer)('the agents command route', () => {
  it('refuses a device that is not a lowercase segment', () =>
    withPeople(async (db) => {
      for (const device of ['Laptop', 'a/b']) {
        const sent = await asIan(db, bindBody(idOf('editor'), CLIENT, device));
        expect(sent.status).toBe(400);
        expect(outcomeOf(sent)).toBe('malformed_command');
      }
      expect(await liveBinding(db, CLIENT)).toBeNull();
    }));

  it('refuses a malformed body and a command it does not serve', () =>
    withPeople(async (db) => {
      const sent = await asIan(db, { command: 'bind_service_token', requestId: randomUUID() });
      expect(sent.status).toBe(400);
      expect(outcomeOf(sent)).toBe('malformed_command');
      expect(outcomeOf(await asIan(db, { command: 'grant_role' }))).toBe('not_wired');
    }));
});

describe.skipIf(!testServer)('an org admin revokes a service token binding', () => {
  it('revokes the live binding, so the next lookup finds none, and refuses a second revoke', () =>
    withPeople(async (db) => {
      await asIan(db, bindBody(idOf('editor')));
      expect(outcomeOf(await asIan(db, revokeBody()))).toBe('accepted');
      expect(await liveBinding(db, CLIENT)).toBeNull();
      expect((await storedRow(db))?.revoked_at).not.toBeNull();
      expect(outcomeOf(await asIan(db, revokeBody()))).toBe('grant_not_found');
    }));

  it('refuses a revoke by an area admin and by a service-token caller', () =>
    withPeople(async (db) => {
      await asIan(db, bindBody(idOf('editor')));
      const byArea = await send(db, { email: people.areaAdmin.email }, revokeBody());
      expect(outcomeOf(byArea)).toBe('not_permitted');
      const bySvc = await send(db, { common_name: CLIENT }, revokeBody());
      expect(outcomeOf(bySvc)).toBe('unauthenticated');
      expect(await liveBinding(db, CLIENT)).toEqual({ personId: idOf('editor'), device: DEVICE });
    }));

  it('refuses binding a revoked token again, so it never comes back live', () =>
    withPeople(async (db) => {
      await asIan(db, bindBody(idOf('editor')));
      await asIan(db, revokeBody());
      expect(outcomeOf(await asIan(db, bindBody(idOf('editor'))))).toBe('grant_exists');
      expect(outcomeOf(await asIan(db, bindBody(idOf('editor'), CLIENT, 'other')))).toBe(
        'grant_exists',
      );
      expect(await liveBinding(db, CLIENT)).toBeNull();
    }));

  it('refuses an unknown token', () =>
    withPeople(async (db) => {
      expect(outcomeOf(await asIan(db, revokeBody('never-bound.access')))).toBe('grant_not_found');
    }));
});

describe.skipIf(!testServer)(
  'only a live person org admin binds or revokes a service token',
  () => {
    it('refuses a service-token caller', () =>
      withPeople(async (db) => {
        const sent = await send(db, { common_name: 'other.access' }, bindBody(idOf('editor')));
        expect(outcomeOf(sent)).toBe('unauthenticated');
        expect(await liveBinding(db, CLIENT)).toBeNull();
      }));

    it("refuses an agent acting under an org admin's grants", () =>
      withPeople(async (db) => {
        const ian = await personOn(db, IAN_ID, IAN, at);
        const agent = agentOf(ian, 'laptop');
        const bind = { ...bindBody(idOf('editor')), command: 'bind_service_token' as const };
        expect(await bindServiceToken(db, agent, bind, randomUUID(), at)).toEqual({
          ok: false,
          reason: 'not_permitted',
        });
        await bindServiceToken(db, ian, bind, randomUUID(), at);
        const revoke = { ...revokeBody(), command: 'revoke_service_token' as const };
        expect(await revokeServiceToken(db, agent, revoke, at)).toEqual({
          ok: false,
          reason: 'not_permitted',
        });
        expect(await liveBinding(db, CLIENT)).not.toBeNull();
      }));

    it('refuses an org admin whose grant has expired by the time of the command', () =>
      withPeople(async (db) => {
        const expiring = await expiringOrgAdmin(db);
        const bind = { ...bindBody(idOf('editor')), command: 'bind_service_token' as const };
        expect(await bindServiceToken(db, expiring, bind, randomUUID(), at)).toEqual({
          ok: false,
          reason: 'not_permitted',
        });
        expect(await liveBinding(db, CLIENT)).toBeNull();
      }));

    it('re-reads the caller grants, so an org admin whose grant was revoked is refused', () =>
      withPeople(async (db) => {
        const ian = await personOn(db, IAN_ID, IAN, at);
        await revokeSeededGrant(db, IAN_GRANT_ID, granted);
        const bind = { ...bindBody(idOf('editor')), command: 'bind_service_token' as const };
        expect(await bindServiceToken(db, ian, bind, randomUUID(), at)).toEqual({
          ok: false,
          reason: 'not_permitted',
        });
        expect(await liveBinding(db, CLIENT)).toBeNull();
      }));
  },
);

describe.skipIf(!testServer)('two concurrent binds of one service token', () => {
  it('accept exactly one and refuse the other grant_exists', () =>
    onTwoConnections(async (dbA, dbB) => {
      await seedPeople(dbA);
      const ian = await personOn(dbA, IAN_ID, IAN, at);
      for (let n = 0; n < 10; n += 1) await racingBinds(ian, dbA, dbB, n);
    }));
});

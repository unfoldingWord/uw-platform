import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { parsePrincipal, type Principal } from '@uw/core/principal';
import { getTableName } from 'drizzle-orm';
import { people } from '@uw/db/schema';
import { owns } from '../people/directory.ts';
import { createApp } from '../app.tsx';
import {
  fixtureAccessEnv,
  createAccessFixture,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const IAN_GRANT_ID = '00000000-0000-4000-8000-000000000101';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

type Reply = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly raw: Response;
};

async function me(db: Database, email: string, accept?: string): Promise<Reply> {
  const token = await fixture.sign({ email });
  const headers: Record<string, string> = { 'cf-access-jwt-assertion': token };
  if (accept) headers['accept'] = accept;
  const raw = await createApp(postgresDeps(db, fixture)).request(
    '/api/me',
    { headers },
    fixtureAccessEnv,
  );
  const text = await raw.clone().text();
  const body = raw.headers.get('content-type')?.includes('json')
    ? (JSON.parse(text) as Record<string, unknown>)
    : {};
  return { status: raw.status, body, raw };
}

function principalOf(reply: Reply): Principal {
  return parsePrincipal(reply.body['principal']);
}

function roleAndArea(principal: Principal) {
  return principal.grants.map((grant) => [grant.role, grant.scopeArea]);
}

async function statusOf(db: Database, email: string): Promise<string | undefined> {
  const rows = await db.execute<{ status: string }>(
    sql`SELECT status FROM people WHERE email = ${email}`,
  );
  return rows[0]?.status;
}

async function countOf(db: Database, email: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM people WHERE email = ${email}`,
  );
  return rows[0]?.n ?? -1;
}

async function personIdOf(db: Database, email: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM people WHERE email = ${email}`);
  return rows[0]?.id ?? '';
}

async function expectPending(db: Database, email: string) {
  const reply = await me(db, email);
  expect(reply.status).toBe(403);
  expect(reply.body).toEqual({ status: 'error', reason: 'pending_approval' });
}

describe.skipIf(!testServer)('FD-7 the principal minted at the edge', () => {
  it('provisions an @unfoldingword.org address as active with no grants', () =>
    withAppDatabase(async (db) => {
      const reply = await me(db, 'new.person@unfoldingword.org');
      expect(reply.status).toBe(200);
      const principal = principalOf(reply);
      expect(principal.kind).toBe('person');
      expect(principal.identity).toBe(
        `human:${await personIdOf(db, 'new.person@unfoldingword.org')}`,
      );
      expect(principal.grants).toEqual([]);
      expect(principal.interactive).toBe(true);
      expect(await statusOf(db, 'new.person@unfoldingword.org')).toBe('active');
    }));

  it('maps a differently cased address to the same people row', () =>
    withAppDatabase(async (db) => {
      const mixed = await me(db, 'Ian.Lindsley@UnfoldingWord.org');
      const lower = await me(db, 'ian.lindsley@unfoldingword.org');
      expect(mixed.status).toBe(200);
      expect(lower.status).toBe(200);
      expect(principalOf(mixed).personId).toBe(IAN_ID);
      expect(principalOf(lower).personId).toBe(IAN_ID);
      expect(await countOf(db, 'ian.lindsley@unfoldingword.org')).toBe(1);
    }));

  it('marks any other address pending and answers with pending approval', () =>
    withAppDatabase(async (db) => {
      await expectPending(db, 'someone@gmail.com');
      expect(await statusOf(db, 'someone@gmail.com')).toBe('pending');
    }));

  it('marks lookalike domains pending', () =>
    withAppDatabase(async (db) => {
      await expectPending(db, 'x@evil-unfoldingword.org');
      await expectPending(db, 'x@unfoldingword.org.evil.com');
    }));

  it('renders the pending approval page for a browser', () =>
    withAppDatabase(async (db) => {
      const reply = await me(db, 'someone@gmail.com', 'text/html');
      expect(reply.status).toBe(403);
      expect(reply.raw.headers.get('content-type')).toContain('text/html');
      const html = await reply.raw.text();
      expect(html).toContain('<h1>Your sign-in is waiting for approval</h1>');
      expect(html).toContain(
        '<p>An unfoldingWord admin needs to approve your account before you can continue.</p>',
      );
      expect(html).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
      );
      expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    }));
});

describe('FD-7 the people directory is the one writer of people', () => {
  it('declares exactly the people table as owned', () => {
    expect(owns).toEqual([getTableName(people)]);
  });
});

describe.skipIf(!testServer)('FD-8 grants resolve from the table on every request', () => {
  it('gives the bootstrap admin the org admin grant', () =>
    withAppDatabase(async (db) => {
      const reply = await me(db, 'ian.lindsley@unfoldingword.org');
      expect(principalOf(reply).grants).toEqual([
        {
          grantId: IAN_GRANT_ID,
          role: 'admin',
          scopeKind: 'org',
          scopeArea: null,
          expiresAt: null,
        },
      ]);
    }));

  it('resolveGrants drops revoked and expired grants, which can() trusts', () =>
    withAppDatabase(async (db) => {
      await me(db, 'g@unfoldingword.org');
      const id = await personIdOf(db, 'g@unfoldingword.org');
      await db.execute(
        sql`INSERT INTO role_grants (person_id, role, scope_kind, granted_by, revoked_at) VALUES (${id}, 'editor', 'org', ${IAN_ID}, now())`,
      );
      await db.execute(
        sql`INSERT INTO role_grants (person_id, role, scope_kind, granted_by, expires_at) VALUES (${id}, 'viewer', 'org', ${IAN_ID}, now() - interval '1 minute')`,
      );
      const reply = await me(db, 'g@unfoldingword.org');
      expect(principalOf(reply).grants).toEqual([]);
    }));

  it('sees a grant added between two requests, with no cache', () =>
    withAppDatabase(async (db) => {
      const first = await me(db, 'h@unfoldingword.org');
      expect(principalOf(first).grants).toEqual([]);
      const id = await personIdOf(db, 'h@unfoldingword.org');
      await db.execute(
        sql`INSERT INTO role_grants (person_id, role, scope_kind, scope_area, granted_by) VALUES (${id}, 'editor', 'jd_area', '80-89', ${IAN_ID})`,
      );
      const second = await me(db, 'h@unfoldingword.org');
      expect(roleAndArea(principalOf(second))).toEqual([['editor', '80-89']]);
    }));

  it('returns a principal that parses back through the contract schema', () =>
    withAppDatabase(async (db) => {
      const reply = await me(db, 'ian.lindsley@unfoldingword.org');
      const body = reply.body['principal'];
      expect(parsePrincipal(JSON.parse(JSON.stringify(body)))).toEqual(body);
    }));
});

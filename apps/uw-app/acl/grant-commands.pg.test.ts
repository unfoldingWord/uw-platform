import { randomUUID } from 'node:crypto';
import { getTableName, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { grantAudit, roleGrants } from '@uw/db/schema';
import { createApp } from '../app.tsx';
import {
  fixtureAccessEnv,
  createAccessFixture,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { owns } from './grant-commands.ts';

const IAN = 'ian.lindsley@unfoldingword.org';
const IAN_ID = '00000000-0000-4000-8000-000000000001';
const SPONSOR_ID = '00000000-0000-4000-8000-000000000002';
const SPONSOR_GRANT_ID = '00000000-0000-4000-8000-000000000102';
const IAN_GRANT_ID = '00000000-0000-4000-8000-000000000101';
const AREA = '80-89';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

type Sent = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly traceId: string;
};
type Audit = {
  actor: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  trace_id: string;
};

async function request(db: Database, claims: Record<string, unknown>, path: string, body: unknown) {
  const token = await fixture.sign(claims);
  const raw = await createApp(postgresDeps(db, fixture)).request(
    path,
    {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    fixtureAccessEnv,
  );
  const body_ = (await raw.json()) as Record<string, unknown>;
  return { status: raw.status, body: body_, traceId: raw.headers.get('x-trace-id') ?? '' };
}

function command(
  db: Database,
  email: string,
  body: { command: string } & Record<string, unknown>,
): Promise<Sent> {
  return request(db, { email }, `/api/acl/commands/${body.command}`, body);
}

async function me(db: Database, email: string) {
  const token = await fixture.sign({ email });
  const raw = await createApp(postgresDeps(db, fixture)).request(
    '/api/me',
    { headers: { 'cf-access-jwt-assertion': token } },
    fixtureAccessEnv,
  );
  return { status: raw.status, body: (await raw.json()) as Record<string, unknown> };
}

async function personId(db: Database, email: string): Promise<string> {
  await me(db, email);
  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM people WHERE email = ${email}`);
  return rows[0]?.id ?? '';
}

async function grantsOf(
  db: Database,
  email: string,
): Promise<{ role: string; scopeArea: string | null }[]> {
  const reply = await me(db, email);
  const principal = reply.body['principal'] as {
    grants: { role: string; scopeArea: string | null }[];
  };
  return principal.grants;
}

function revokeCommand(db: Database, grantId: string): Promise<Sent> {
  return command(db, IAN, { command: 'revoke_role', requestId: randomUUID(), grantId });
}

function grantBody(personId_: string, role: string, scopeArea: string | null, extra = {}) {
  return {
    command: 'grant_role',
    requestId: randomUUID(),
    personId: personId_,
    role,
    scopeKind: scopeArea === null ? 'org' : 'jd_area',
    scopeArea,
    expiresAt: null,
    ...extra,
  };
}

async function audits(db: Database): Promise<Audit[]> {
  return [
    ...(await db.execute<Audit>(
      sql`SELECT actor, action, before, after, trace_id FROM grant_audit WHERE action <> 'bootstrap' ORDER BY ctid`,
    )),
  ];
}

async function auditActions(db: Database): Promise<string[]> {
  const rows = await audits(db);
  return rows.map((row) => row.action);
}

async function grantIdFor(db: Database, email: string, role: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT g.id FROM role_grants g JOIN people p ON p.id = g.person_id WHERE p.email = ${email} AND g.role = ${role} AND g.revoked_at IS NULL`,
  );
  return rows[0]?.id ?? '';
}

async function seedAdminOf(db: Database, email: string): Promise<void> {
  const id = await personId(db, IAN);
  const target = await personId(db, email);
  const sent = await command(db, IAN, grantBody(target, 'admin', AREA));
  expect(sent.status).toBe(200);
  expect(id).toBe(IAN_ID);
}

describe('FD-8 the grant commands are the only writer of grants', () => {
  it('declares exactly role_grants and grant_audit as owned', () => {
    expect(owns).toEqual([getTableName(roleGrants), getTableName(grantAudit)]);
  });
});

describe.skipIf(!testServer)('FD-8 grant_role by an admin', () => {
  it('lets an org admin grant, and audits actor, before, after and trace id', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'e@unfoldingword.org');
      const sent = await command(db, IAN, grantBody(target, 'editor', AREA));
      expect(sent.status).toBe(200);
      expect(sent.body).toEqual({ status: 'accepted', requestId: expect.any(String) });
      expect(await grantsOf(db, 'e@unfoldingword.org')).toMatchObject([
        { role: 'editor', scopeArea: AREA },
      ]);
      const [row, ...rest] = await audits(db);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({ actor: `human:${IAN_ID}`, action: 'grant', before: null });
      expect(row?.after).toMatchObject({ role: 'editor', scope_area: AREA, person_id: target });
      expect(row?.trace_id).toBe(sent.traceId);
    }));

  it('refuses an editor, writing no audit row', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'e@unfoldingword.org');
      await command(db, IAN, grantBody(target, 'editor', AREA));
      const before = (await audits(db)).length;
      const sent = await command(
        db,
        'e@unfoldingword.org',
        grantBody(await personId(db, 'v@unfoldingword.org'), 'viewer', AREA),
      );
      expect(sent.status).toBe(403);
      expect(sent.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      expect((await audits(db)).length).toBe(before);
    }));

  it('lets an area admin grant within the area and nowhere else', () =>
    withAppDatabase(async (db) => {
      await seedAdminOf(db, 'a@unfoldingword.org');
      const viewer = await personId(db, 'v@unfoldingword.org');
      const inside = await command(db, 'a@unfoldingword.org', grantBody(viewer, 'viewer', AREA));
      const otherArea = await command(
        db,
        'a@unfoldingword.org',
        grantBody(viewer, 'editor', '20-29'),
      );
      const atOrg = await command(db, 'a@unfoldingword.org', grantBody(viewer, 'admin', null));
      expect(inside.status).toBe(200);
      expect([otherArea.status, otherArea.body['reason']]).toEqual([403, 'not_permitted']);
      expect([atOrg.status, atOrg.body['reason']]).toEqual([403, 'not_permitted']);
    }));
});

describe.skipIf(!testServer)('FD-8 grant_role against an existing grant', () => {
  it('refuses a repeat of a live grant', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'e@unfoldingword.org');
      await command(db, IAN, grantBody(target, 'editor', AREA));
      const again = await command(db, IAN, grantBody(target, 'editor', AREA));
      expect([again.status, again.body['reason']]).toEqual([409, 'grant_exists']);
    }));

  it('closes an expired duplicate with its own revoke row, then grants', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'x@unfoldingword.org');
      await db.execute(
        sql`INSERT INTO role_grants (person_id, role, scope_kind, scope_area, granted_by, expires_at) VALUES (${target}, 'editor', 'jd_area', ${AREA}, ${IAN_ID}, now() - interval '1 day')`,
      );
      const sent = await command(db, IAN, grantBody(target, 'editor', AREA));
      expect(sent.status).toBe(200);
      expect(await grantsOf(db, 'x@unfoldingword.org')).toHaveLength(1);
      expect(await auditActions(db)).toEqual(['revoke', 'grant']);
    }));
});

describe.skipIf(!testServer)('FD-8 grant_role refusals and approval of a pending person', () => {
  it('refuses an expiry in the past', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'e@unfoldingword.org');
      const past = new Date(Date.now() - 60_000).toISOString();
      const sent = await command(db, IAN, grantBody(target, 'editor', AREA, { expiresAt: past }));
      expect([sent.status, sent.body['reason']]).toEqual([422, 'expiry_in_past']);
    }));

  it('refuses a person who does not exist', () =>
    withAppDatabase(async (db) => {
      const sent = await command(db, IAN, grantBody(randomUUID(), 'editor', AREA));
      expect([sent.status, sent.body['reason']]).toEqual([404, 'person_not_found']);
    }));

  it('leaves a pending person pending when an area admin grants', () =>
    withAppDatabase(async (db) => {
      await seedAdminOf(db, 'a@unfoldingword.org');
      expect((await me(db, 'pending@gmail.com')).status).toBe(403);
      const target = await personId(db, 'pending@gmail.com');
      const sent = await command(db, 'a@unfoldingword.org', grantBody(target, 'viewer', AREA));
      expect([sent.status, sent.body['reason']]).toEqual([403, 'not_permitted']);
      const rows = await db.execute<{ status: string }>(
        sql`SELECT status FROM people WHERE id = ${target}`,
      );
      expect(rows[0]?.status).toBe('pending');
    }));

  it('activates a pending person when an org admin grants', () =>
    withAppDatabase(async (db) => {
      expect((await me(db, 'pending@gmail.com')).status).toBe(403);
      const target = await personId(db, 'pending@gmail.com');
      const sent = await command(db, IAN, grantBody(target, 'viewer', AREA));
      expect(sent.status).toBe(200);
      const rows = await db.execute<{ status: string }>(
        sql`SELECT status FROM people WHERE id = ${target}`,
      );
      expect(rows[0]?.status).toBe('active');
      expect((await me(db, 'pending@gmail.com')).status).toBe(200);
    }));

  it('refuses a service token', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'e@unfoldingword.org');
      const body = grantBody(target, 'editor', AREA);
      const sent = await request(
        db,
        { common_name: 'svc-test' },
        '/api/acl/commands/grant_role',
        body,
      );
      expect([sent.status, sent.body['reason']]).toEqual([401, 'unauthenticated']);
    }));
});

describe.skipIf(!testServer)('FD-8 revoke_role', () => {
  it('revokes, auditing the before and after rows', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'e@unfoldingword.org');
      await command(db, IAN, grantBody(target, 'editor', AREA));
      const grantId = await grantIdFor(db, 'e@unfoldingword.org', 'editor');
      const sent = await command(db, IAN, {
        command: 'revoke_role',
        requestId: randomUUID(),
        grantId,
      });
      expect(sent.status).toBe(200);
      const last = (await audits(db)).at(-1);
      expect(last?.action).toBe('revoke');
      expect(last?.before?.['revoked_at']).toBeNull();
      expect(last?.after?.['revoked_at']).not.toBeNull();
      expect(last?.trace_id).toBe(sent.traceId);
      expect(await grantsOf(db, 'e@unfoldingword.org')).toEqual([]);
    }));

  it('answers grant_not_found for a revoked grant and an unknown id', () =>
    withAppDatabase(async (db) => {
      const target = await personId(db, 'e@unfoldingword.org');
      await command(db, IAN, grantBody(target, 'editor', AREA));
      const grantId = await grantIdFor(db, 'e@unfoldingword.org', 'editor');
      await revokeCommand(db, grantId);
      for (const id of [grantId, randomUUID()]) {
        const sent = await revokeCommand(db, id);
        expect([sent.status, sent.body['reason']]).toEqual([404, 'grant_not_found']);
      }
    }));

  it('refuses to remove the last org admin', () =>
    withAppDatabase(async (db) => {
      await db.execute(
        sql`INSERT INTO people (id, email, display_name, status) VALUES (${SPONSOR_ID}, 'sponsor@unfoldingword.org', 'Sponsor', 'active')`,
      );
      await db.execute(
        sql`INSERT INTO role_grants (id, person_id, role, scope_kind, granted_by) VALUES (${SPONSOR_GRANT_ID}, ${SPONSOR_ID}, 'admin', 'org', ${IAN_ID})`,
      );
      const first = await revokeCommand(db, SPONSOR_GRANT_ID);
      const second = await revokeCommand(db, IAN_GRANT_ID);
      expect(first.status).toBe(200);
      expect([second.status, second.body['reason']]).toEqual([409, 'last_org_admin']);
    }));
});

describe.skipIf(!testServer)('FD-8 command bodies', () => {
  it('answers a body that fails its schema with a bare refusal when it has no request id', () =>
    withAppDatabase(async (db) => {
      const sent = await command(db, IAN, { command: 'grant_role' });
      expect(sent.status).toBe(400);
      expect(sent.body).toEqual({ status: 'error', reason: 'malformed_command' });
    }));

  it('echoes a valid request id on a malformed body', () =>
    withAppDatabase(async (db) => {
      const requestId = randomUUID();
      const target = await personId(db, 'e@unfoldingword.org');
      const body = grantBody(target, 'owner', AREA, { requestId });
      const sent = await command(db, IAN, body);
      expect(sent.status).toBe(400);
      expect(sent.body).toEqual({ status: 'error', requestId, reason: 'malformed_command' });
    }));

  it('answers an unknown command name with not_wired', () =>
    withAppDatabase(async (db) => {
      const sent = await command(db, IAN, { command: 'approve' });
      expect([sent.status, sent.body['reason']]).toEqual([404, 'not_wired']);
    }));
});

async function liveGrantCount(db: Database): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM role_grants WHERE revoked_at IS NULL`,
  );
  return rows[0]?.n ?? -1;
}

async function expectRevokeRefused(db: Database, email: string, grantId: string): Promise<void> {
  const auditsBefore = (await audits(db)).length;
  const liveBefore = await liveGrantCount(db);
  const sent = await command(db, email, {
    command: 'revoke_role',
    requestId: randomUUID(),
    grantId,
  });
  expect([sent.status, sent.body['reason']]).toEqual([403, 'not_permitted']);
  expect((await audits(db)).length).toBe(auditsBefore);
  expect(await liveGrantCount(db)).toBe(liveBefore);
}

async function grantTo(db: Database, email: string, role: string, area: string | null) {
  const sent = await command(db, IAN, grantBody(await personId(db, email), role, area));
  expect(sent.status).toBe(200);
  return grantIdFor(db, email, role);
}

describe.skipIf(!testServer)('FD-8 revoke_role refusals', () => {
  it('refuses an editor', () =>
    withAppDatabase(async (db) => {
      await grantTo(db, 'e@unfoldingword.org', 'editor', AREA);
      const viewerGrant = await grantTo(db, 'v@unfoldingword.org', 'viewer', AREA);
      await expectRevokeRefused(db, 'e@unfoldingword.org', viewerGrant);
    }));

  it('refuses an area admin revoking an org admin grant', () =>
    withAppDatabase(async (db) => {
      await grantTo(db, 'a@unfoldingword.org', 'admin', AREA);
      await expectRevokeRefused(db, 'a@unfoldingword.org', IAN_GRANT_ID);
    }));

  it('refuses an area admin revoking a grant in another area', () =>
    withAppDatabase(async (db) => {
      await grantTo(db, 'a@unfoldingword.org', 'admin', AREA);
      const elsewhere = await grantTo(db, 'w@unfoldingword.org', 'editor', '20-29');
      await expectRevokeRefused(db, 'a@unfoldingword.org', elsewhere);
    }));
});

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { get, post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const ROWAN = 'rowan.test@unfoldingword.org';

type GrantRow = { role: string; scope_area: string | null; granted_by: string | null };
type AuditRow = { actor: string; action: string };

async function idOf(db: Database, email: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM people WHERE email = ${email}`);
  return rows[0]?.id ?? '';
}

async function liveGrants(db: Database, email: string): Promise<GrantRow[]> {
  const rows = await db.execute<GrantRow>(sql`
    SELECT g.role, g.scope_area, g.granted_by FROM role_grants g JOIN people p ON p.id = g.person_id
    WHERE p.email = ${email} AND g.revoked_at IS NULL ORDER BY g.granted_at`);
  return [...rows];
}

async function audits(db: Database, email: string): Promise<AuditRow[]> {
  const rows = await db.execute<AuditRow>(sql`
    SELECT a.actor, a.action FROM grant_audit a JOIN role_grants g ON g.id = a.grant_id
    JOIN people p ON p.id = g.person_id WHERE p.email = ${email} ORDER BY a.at`);
  return [...rows];
}

const signIn = (db: Database, email: string) => get(db, { email }, '/api/me');

async function staffGetIt(db: Database): Promise<void> {
  const email = 'new.colleague@unfoldingword.org';
  expect((await signIn(db, email)).status).toBe(200);
  expect(await liveGrants(db, email)).toEqual([
    { role: 'viewer', scope_area: '00-09', granted_by: null },
  ]);
  expect(await audits(db, email)).toEqual([
    { actor: `human:${await idOf(db, email)}`, action: 'default' },
  ]);
  const list = await get(db, { email }, '/api/pages?area=00-09');
  expect(list.status).toBe(200);
  await signIn(db, email);
  expect(await liveGrants(db, email)).toHaveLength(1);
}

async function approvedGetIt(db: Database): Promise<void> {
  const email = 'partner@example.org';
  expect((await signIn(db, email)).body).toMatchObject({ reason: 'pending_approval' });
  expect(await liveGrants(db, email)).toEqual([]);
  const approved = await post(db, ROWAN, '/api/acl/commands/approve_person', {
    command: 'approve_person',
    requestId: crypto.randomUUID(),
    personId: await idOf(db, email),
  });
  expect(approved.body).toMatchObject({ status: 'accepted' });
  expect(await liveGrants(db, email)).toEqual([
    { role: 'viewer', scope_area: '00-09', granted_by: await idOf(db, ROWAN) },
  ]);
  expect((await signIn(db, email)).status).toBe(200);
}

async function revokedStaysRevoked(db: Database): Promise<void> {
  const email = 'left.the.team@unfoldingword.org';
  await signIn(db, email);
  await db.execute(sql`
    UPDATE role_grants SET revoked_at = now() WHERE person_id = ${await idOf(db, email)}::uuid`);
  await signIn(db, email);
  expect(await liveGrants(db, email)).toEqual([]);
  const list = await get(db, { email }, '/api/pages?area=00-09');
  expect(list.body).toMatchObject({ pages: [] });
}

async function adminsAreNotDoubled(db: Database): Promise<void> {
  await signIn(db, ROWAN);
  const grants = await liveGrants(db, ROWAN);
  expect(grants.filter((grant) => grant.scope_area === '00-09')).toEqual([]);
  expect(grants.some((grant) => grant.scope_area === null)).toBe(true);
}

describe.skipIf(!testServer)('#175 everyone reads 00-09 by default', () => {
  it('gives a new member of staff viewer on 00-09 at first sign-in, once, and records it', () =>
    withAppDatabase(staffGetIt));

  it('gives an approved outsider the same grant, named to the admin who approved them', () =>
    withAppDatabase(approvedGetIt));

  it('does not give the grant back after an admin revokes it', () =>
    withAppDatabase(revokedStaysRevoked));

  it('gives nothing extra to a person who already reads every area', () =>
    withAppDatabase(adminsAreNotDoubled));
});

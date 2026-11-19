import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

const ROWAN = 'rowan.test@unfoldingword.org';
const ROWAN_ID = '00000000-0000-4000-8000-000000000001';
const AREA_ADMIN = 'area.admin@unfoldingword.org';
const AREA_ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';
const OUTSIDER = 'partner@example.org';
const OUTSIDER_ID = '00000000-0000-4000-8000-0000000000b2';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

type Sent = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly traceId: string;
};

async function send(db: Database, email: string, path: string, body?: unknown): Promise<Sent> {
  const token = await fixture.sign({ email });
  const headers = { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' };
  const init =
    body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) };
  const raw = await createApp(postgresDeps(db, fixture)).request(path, init, fixtureAccessEnv);
  const read = (await raw.json()) as Record<string, unknown>;
  return { status: raw.status, body: read, traceId: raw.headers.get('x-trace-id') ?? '' };
}

function decide(db: Database, email: string, name: string, personId: string): Promise<Sent> {
  const body = { command: name, requestId: randomUUID(), personId };
  return send(db, email, `/api/acl/commands/${name}`, body);
}

async function statusOf(db: Database, personId: string): Promise<string | undefined> {
  const rows = await db.execute<{ status: string }>(
    sql`SELECT status FROM people WHERE id = ${personId}`,
  );
  return rows[0]?.status;
}

type Audit = {
  actor: string;
  action: string;
  person_id: string;
  before: string;
  after: string;
  trace_id: string;
};

async function auditOf(db: Database): Promise<Audit[]> {
  const rows = await db.execute<Audit>(
    sql`SELECT actor, action, person_id, before, after, trace_id FROM person_audit ORDER BY at, id`,
  );
  return [...rows];
}

async function scene(db: Database): Promise<void> {
  await seedPerson(db, { id: AREA_ADMIN_ID, email: AREA_ADMIN });
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-0000000000c1',
    personId: AREA_ADMIN_ID,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '30-39',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  await seedPerson(db, { id: OUTSIDER_ID, email: OUTSIDER, status: 'pending' });
}

async function approvesAndAudits(db: Database): Promise<void> {
  await scene(db);
  expect((await send(db, OUTSIDER, '/api/me')).body['reason']).toBe('pending_approval');
  const approved = await decide(db, ROWAN, 'approve_person', OUTSIDER_ID);
  expect(approved.body['status']).toBe('accepted');
  expect(await statusOf(db, OUTSIDER_ID)).toBe('active');
  expect((await send(db, OUTSIDER, '/api/me')).status).toBe(200);
  expect(await auditOf(db)).toEqual([
    {
      actor: `human:${ROWAN_ID}`,
      action: 'approve',
      person_id: OUTSIDER_ID,
      before: 'pending',
      after: 'active',
      trace_id: approved.traceId,
    },
  ]);
}

async function areaAdminRefused(db: Database): Promise<void> {
  await scene(db);
  for (const name of ['approve_person', 'decline_person']) {
    const refused = await decide(db, AREA_ADMIN, name, OUTSIDER_ID);
    expect(refused.status).toBe(403);
    expect(refused.body['reason']).toBe('not_permitted');
  }
  expect(await statusOf(db, OUTSIDER_ID)).toBe('pending');
  expect(await auditOf(db)).toEqual([]);
}

async function declinedThenRestored(db: Database): Promise<void> {
  await scene(db);
  const declined = await decide(db, ROWAN, 'decline_person', OUTSIDER_ID);
  expect(declined.body['status']).toBe('accepted');
  expect(await statusOf(db, OUTSIDER_ID)).toBe('disabled');
  const refused = await send(db, OUTSIDER, '/api/me');
  expect(refused.status).toBe(403);
  expect(refused.body).toEqual({ status: 'error', reason: 'not_permitted' });
  expect((await decide(db, ROWAN, 'approve_person', OUTSIDER_ID)).body['status']).toBe('accepted');
  expect((await send(db, OUTSIDER, '/api/me')).status).toBe(200);
  expect((await auditOf(db)).map((row) => `${row.action}:${row.before}>${row.after}`)).toEqual([
    'decline:pending>disabled',
    'approve:disabled>active',
  ]);
}

async function misfitsRefused(db: Database): Promise<void> {
  await scene(db);
  const active = await decide(db, ROWAN, 'decline_person', AREA_ADMIN_ID);
  expect(active.body['reason']).toBe('transition_not_allowed');
  const again = await decide(db, ROWAN, 'approve_person', AREA_ADMIN_ID);
  expect(again.body['reason']).toBe('transition_not_allowed');
  const nobody = await decide(db, ROWAN, 'approve_person', randomUUID());
  expect(nobody.status).toBe(404);
  expect(nobody.body['reason']).toBe('person_not_found');
  expect(await statusOf(db, AREA_ADMIN_ID)).toBe('active');
  expect(await auditOf(db)).toEqual([]);
}

async function grantApproves(db: Database): Promise<void> {
  await scene(db);
  const granted = await send(db, ROWAN, '/api/acl/commands/grant_role', {
    command: 'grant_role',
    requestId: randomUUID(),
    personId: OUTSIDER_ID,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '30-39',
    expiresAt: null,
  });
  expect(granted.body['status']).toBe('accepted');
  expect((await auditOf(db)).map((row) => `${row.action}:${row.person_id}`)).toEqual([
    `approve:${OUTSIDER_ID}`,
  ]);
}

describe.skipIf(!testServer)('#154 approving and declining a pending person', () => {
  it('an org admin approves a pending person, who reaches the app on the next request, and the change is audited', () =>
    withAppDatabase(approvesAndAudits));

  it('an area admin cannot approve or decline, and nothing changes', () =>
    withAppDatabase(areaAdminRefused));

  it('a declined person is disabled, is refused at the edge, and can be approved later', () =>
    withAppDatabase(declinedThenRestored));

  it('refuses a decision that does not fit the person, in the closed set', () =>
    withAppDatabase(misfitsRefused));

  it('a grant to a pending person by an org admin approves them and audits the approval', () =>
    withAppDatabase(grantApproves));
});

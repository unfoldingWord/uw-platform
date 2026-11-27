import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { post } from '../../testing/commands.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';

const ANA = 'ana.turns.on@unfoldingword.org';
const BEN = 'ben.turns.on@unfoldingword.org';
const anaId = '00000000-0000-4000-8000-0000000e3601';
const benId = '00000000-0000-4000-8000-0000000e3602';

async function staff(db: Database, id: string, email: string): Promise<void> {
  await seedPerson(db, { id, email });
  await seedGrant(db, {
    id: randomUUID(),
    personId: id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '30-39',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
}

function command(db: Database, email: string, body: Record<string, unknown>) {
  return post(db, email, `/api/assistant/commands/${String(body['command'])}`, {
    requestId: randomUUID(),
    ...body,
  });
}

async function accountOf(db: Database, personId: string) {
  const rows = await db.execute<{ jd_id: string | null; status: string; harness_id: string }>(
    sql`SELECT jd_id, status, harness_id FROM assistant_accounts WHERE person_id = ${personId}`,
  );
  return rows[0] ?? null;
}

async function liveAssist(db: Database, personId: string): Promise<number> {
  const rows = await db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM delegations WHERE person_id = ${personId}
      AND capability = 'assist' AND revoked_at IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function turnOnConfirmAndTurnOff(db: Database): Promise<void> {
  await staff(db, anaId, ANA);
  await staff(db, benId, BEN);
  const on = await command(db, ANA, { command: 'enable_assistant', name: 'Barnabas' });
  expect(on.body).toMatchObject({ status: 'accepted' });
  expect(await accountOf(db, anaId)).toMatchObject({ jd_id: '10.51', status: 'enabled' });
  const [progress] = await db.execute<{ step: string; failure: string | null }>(
    sql`SELECT step, failure FROM assistant_provisioning`,
  );
  expect(progress).toEqual({ step: 'workspace_user', failure: 'workspace_not_wired' });
  const taken = await command(db, BEN, { command: 'enable_assistant', name: 'barnabas' });
  expect(taken.body).toMatchObject({ status: 'error', reason: 'assistant_name_taken' });
  const granted = await command(db, ANA, { command: 'grant_assist', expiresAt: null });
  expect(granted.body).toMatchObject({ status: 'accepted' });
  expect(await liveAssist(db, anaId)).toBe(1);
  const off = await command(db, ANA, { command: 'disable_assistant' });
  expect(off.body).toMatchObject({ status: 'accepted' });
  expect(await accountOf(db, anaId)).toMatchObject({ jd_id: '10.51', status: 'disabled' });
  expect(await liveAssist(db, anaId)).toBe(0);
}

async function refusesWhatIsNotTheirs(db: Database): Promise<void> {
  await staff(db, benId, BEN);
  const none = await command(db, BEN, { command: 'grant_assist', expiresAt: null });
  expect(none.body).toMatchObject({ status: 'error', reason: 'no_assistant' });
  const reserved = await command(db, BEN, { command: 'enable_assistant', name: 'postmaster' });
  expect(reserved.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
  const someone = await command(db, BEN, {
    command: 'enable_assistant',
    name: 'silas',
    personId: anaId,
  });
  expect(someone.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
  expect(await accountOf(db, benId)).toBeNull();
}

describe.skipIf(!testServer)('PA-14 the person turns their own assistant on and off', () => {
  it('turns it on with 10.51, starts provisioning, takes the assist grant and turns it off', () =>
    withAppDatabase(turnOnConfirmAndTurnOff));

  it('refuses a reserved name, a body naming someone else, and a grant with no assistant', () =>
    withAppDatabase(refusesWhatIsNotTheirs));
});

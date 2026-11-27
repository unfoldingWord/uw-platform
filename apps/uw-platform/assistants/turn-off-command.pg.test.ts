import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const ROWAN = 'rowan.test@unfoldingword.org';
const ANA = 'ana.leaves@unfoldingword.org';
const BEN = 'ben.stays@unfoldingword.org';
const anaId = '00000000-0000-4000-8000-0000000e5601';
const benId = '00000000-0000-4000-8000-0000000e5602';

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

function own(db: Database, email: string, body: Record<string, unknown>) {
  return post(db, email, `/api/assistant/commands/${String(body['command'])}`, {
    requestId: randomUUID(),
    ...body,
  });
}

function turnOff(db: Database, email: string, personId: string) {
  return post(db, email, '/api/acl/commands/disable_person_assistant', {
    command: 'disable_person_assistant',
    requestId: randomUUID(),
    personId,
  });
}

async function stateOf(db: Database) {
  const [row] = await db.execute<{ status: string; assists: string }>(
    sql`SELECT a.status, (SELECT count(*)::text FROM delegations d WHERE d.person_id = a.person_id
      AND d.capability = 'assist' AND d.revoked_at IS NULL) AS assists
      FROM assistant_accounts a WHERE a.person_id = ${anaId}`,
  );
  return row ?? null;
}

async function anAdminTurnsItOff(db: Database): Promise<void> {
  await staff(db, anaId, ANA);
  await staff(db, benId, BEN);
  await own(db, ANA, { command: 'enable_assistant', name: 'barnabas' });
  await own(db, ANA, { command: 'grant_assist', expiresAt: null });
  expect(await stateOf(db)).toEqual({ status: 'enabled', assists: '1' });
  for (const email of [ANA, BEN]) {
    const refused = await turnOff(db, email, anaId);
    expect(refused.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  }
  expect(await stateOf(db)).toEqual({ status: 'enabled', assists: '1' });
  expect((await turnOff(db, ROWAN, anaId)).body).toMatchObject({ status: 'accepted' });
  expect(await stateOf(db)).toEqual({ status: 'disabled', assists: '0' });
  const none = await turnOff(db, ROWAN, benId);
  expect(none.body).toMatchObject({ status: 'error', reason: 'no_assistant' });
}

describe.skipIf(!testServer)('PA-20 disable_person_assistant', () => {
  it('lets an org admin turn off any person’s assistant and refuses everyone else', () =>
    withAppDatabase(anAdminTurnsItOff));
});

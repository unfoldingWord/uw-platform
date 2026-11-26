import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPerson } from '@uw/db/test-seed';
import { post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const ROWAN = 'rowan.test@unfoldingword.org';
const ANA = 'ana.budget@unfoldingword.org';
const person = '00000000-0000-4000-8000-0000000b0d01';
const harness = '00000000-0000-4000-8000-0000000b0d02';
const at = '2026-11-26T09:00:00.000Z';

async function assistantOf(db: Database): Promise<void> {
  await seedPerson(db, { id: person, email: ANA });
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${harness}, ${`assistant-${person}`}, 'Assistant', 'assistant', '10-19',
      ${at}::timestamptz, ${person})`);
}

function setBudget(db: Database, email: string, monthlyMinor: number | null) {
  return post(db, email, '/api/acl/commands/set_assistant_budget', {
    command: 'set_assistant_budget',
    requestId: randomUUID(),
    personId: person,
    monthlyMinor,
  });
}

async function budgetOf(db: Database): Promise<number | null> {
  const rows = await db.execute<{ monthly_minor: number }>(
    sql`SELECT monthly_minor FROM assistant_budgets WHERE harness_id = ${harness}`,
  );
  return rows[0]?.monthly_minor ?? null;
}

async function anAdminSetsIt(db: Database): Promise<void> {
  await assistantOf(db);
  expect((await setBudget(db, ROWAN, 5000)).body).toMatchObject({ status: 'accepted' });
  expect(await budgetOf(db)).toBe(5000);
  expect((await setBudget(db, ROWAN, null)).body).toMatchObject({ status: 'accepted' });
  expect(await budgetOf(db)).toBeNull();
}

async function nobodyElseSetsIt(db: Database): Promise<void> {
  await assistantOf(db);
  const own = await setBudget(db, ANA, 9000);
  expect(own.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const malformed = await post(db, ROWAN, '/api/acl/commands/set_assistant_budget', {
    command: 'set_assistant_budget',
    requestId: randomUUID(),
    personId: person,
    monthlyMinor: -5,
  });
  expect(malformed.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
  expect(await budgetOf(db)).toBeNull();
}

describe.skipIf(!testServer)('PA-16 set_assistant_budget', () => {
  it('lets an org admin set and clear one person assistant budget', () =>
    withAppDatabase(anAdminSetsIt));

  it('refuses the person themself and a malformed amount', () => withAppDatabase(nobodyElseSetsIt));
});

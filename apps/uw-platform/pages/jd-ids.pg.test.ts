import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPerson } from '@uw/db/test-seed';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { takenJdIds } from './jd-ids.ts';

const person = '00000000-0000-4000-8000-0000000e2601';
const harness = '00000000-0000-4000-8000-0000000e2602';
const at = '2026-11-27T09:00:00.000Z';

async function assistantHolding(db: Database, jdId: string): Promise<void> {
  await seedPerson(db, { id: person, email: 'ana@example.org' });
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${harness}, ${`assistant-${person}`}, ${`${jdId} Barnabas`}, 'assistant', '10-19',
      ${at}::timestamptz, ${person})`);
  await db.execute(sql`INSERT INTO assistant_accounts
      (harness_id, person_id, name, jd_id, status, version, created_at, updated_at)
    VALUES (${harness}, ${person}, 'barnabas', ${jdId}, 'enabled', 1, ${at}::timestamptz,
      ${at}::timestamptz)`);
}

describe.skipIf(!testServer)('PA-14 the wiki does not reuse an assistant number', () => {
  it('counts an assistant JD id as taken in category 10 only', () =>
    withAppDatabase(async (db) => {
      await assistantHolding(db, '10.51');
      expect((await takenJdIds(db, '10')).has('10.51')).toBe(true);
      expect((await takenJdIds(db, '20')).has('10.51')).toBe(false);
    }));
});

import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import { orgAddresses, personMailOf, putMailbox, subjectKindOf } from './subjects.ts';

const domain = 'unfoldingword.org';
const ana = 'c7000000-0000-4000-8000-000000000001';
const gone = 'c7000000-0000-4000-8000-000000000002';
const outsider = 'c7000000-0000-4000-8000-000000000003';
const personal = 'c7000000-0000-4000-8000-0000000000a1';
const at = new Date('2026-11-26T09:00:00.000Z');

let opened: { database: TestDatabase; db: Database } | null = null;

async function seeded(): Promise<Database> {
  if (opened !== null) return opened.db;
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedPerson(db, { id: ana, email: 'ana@unfoldingword.org' });
  await seedPerson(db, { id: gone, email: 'gone@unfoldingword.org', status: 'disabled' });
  await seedPerson(db, { id: outsider, email: 'guest@partner.example' });
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${personal}, ${`assistant-${ana}`}, 'Assistant', 'assistant', '10-19',
      ${at.toISOString()}::timestamptz, ${ana})`);
  opened = { database, db };
  return db;
}

afterAll(async () => {
  await opened?.db.$client.end();
  await opened?.database.drop();
});

describe.skipIf(!testServer)('PA-8 who the Workspace key may act as', () => {
  it('names an active person inside the domain, and nobody else, as a calendar subject', async () => {
    const db = await seeded();
    expect(await personMailOf(db, ana, domain)).toBe('ana@unfoldingword.org');
    expect(await personMailOf(db, gone, domain)).toBeNull();
    expect(await personMailOf(db, outsider, domain)).toBeNull();
    expect(await subjectKindOf(db, 'ana@unfoldingword.org', domain)).toBe('person');
    expect(await subjectKindOf(db, 'gone@unfoldingword.org', domain)).toBeNull();
    expect(await subjectKindOf(db, 'guest@partner.example', domain)).toBeNull();
    const inside = await orgAddresses(
      db,
      ['ana@unfoldingword.org', 'gone@unfoldingword.org', 'guest@partner.example'],
      domain,
    );
    expect([...inside]).toEqual(['ana@unfoldingword.org']);
  });

  it('names an active assistant mailbox as a mailbox subject, and a suspended one as nobody', async () => {
    const db = await seeded();
    const mailbox = {
      harnessId: personal,
      personId: ana,
      address: 'barnabas@unfoldingword.org',
      googleUserId: null,
      status: 'active' as const,
      at,
    };
    await putMailbox(db, mailbox);
    expect(await subjectKindOf(db, 'barnabas@unfoldingword.org', domain)).toBe('assistant_mailbox');
    await putMailbox(db, { ...mailbox, status: 'suspended' });
    expect(await subjectKindOf(db, 'barnabas@unfoldingword.org', domain)).toBeNull();
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, describe } from 'vitest';
import { personPrincipal } from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPage, seedPerson } from '@uw/db/test-seed';
import { describePageAppendsContract } from '@uw/harness/port-contracts/page-appends';
import { platformPageAppends } from './page-appends.ts';

const area = '30-39';
const personId = 'c7100000-0000-4000-8000-000000000001';
let opened: { database: TestDatabase; db: Database } | null = null;
let pagesAdded = 0;

async function database(): Promise<Database> {
  if (opened === null) {
    const created = await createMigratedDatabase(testServer ?? '');
    opened = { database: created, db: createClient(created.connectionString) };
    await seedPerson(opened.db, { id: personId, email: 'append-person@example.org' });
  }
  return opened.db;
}

afterAll(async () => {
  await opened?.db.$client.end();
  await opened?.database.drop();
});

function pageIdOf(n: number): string {
  return `c7100000-0000-4000-8000-${(0x100 + n).toString(16).padStart(12, '0')}`;
}

describe.skipIf(!testServer)('DX-3 the page appends adapter on Postgres', () => {
  describePageAppendsContract('the normal page update path', async () => {
    const db = await database();
    const clock = { now: () => new Date() };
    return {
      pageAppends: platformPageAppends(db, clock),
      area,
      addPage: async (bodyMd) => {
        pagesAdded += 1;
        const id = pageIdOf(pagesAdded);
        await seedPage(db, {
          id,
          type: 'knowledge',
          status: 'active',
          jdArea: area,
          slug: `notes-${String(pagesAdded)}`,
          title: 'Project notes',
          bodyMd,
          frontmatter: { jd_category: '31' },
        });
        return id;
      },
      page: async (pageId) => {
        const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
        return row === undefined ? null : { bodyMd: row.bodyMd, version: row.version };
      },
      person: async (role) =>
        personPrincipal({
          personId,
          email: 'append-person@example.org',
          interactive: true,
          grants: [
            {
              grantId: 'c7100000-0000-4000-8000-0000000000b1',
              role,
              scopeKind: 'jd_area',
              scopeArea: area,
              expiresAt: null,
            },
          ],
        }),
    };
  });
});

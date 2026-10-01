import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { personPrincipal, type Principal } from '@uw/core/principal';
import { revokeRole } from './grant-commands.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const JESSE_ID = '00000000-0000-4000-8000-000000000002';
const IAN_GRANT_ID = '00000000-0000-4000-8000-000000000101';
const JESSE_GRANT_ID = '00000000-0000-4000-8000-000000000102';
const ROUNDS = 10;

function orgAdmin(personId: string, email: string, grantId: string): Principal {
  return personPrincipal({
    personId,
    email,
    interactive: true,
    grants: [{ grantId, role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null }],
  });
}

async function liveOrgAdmins(db: Database): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM role_grants WHERE role = 'admin' AND scope_kind = 'org' AND revoked_at IS NULL`,
  );
  return rows[0]?.n ?? -1;
}

async function seedJesse(db: Database): Promise<void> {
  await db.execute(
    sql`INSERT INTO people (id, email, display_name, status) VALUES (${JESSE_ID}, 'jesse@unfoldingword.org', 'Jesse', 'active')`,
  );
  await db.execute(
    sql`INSERT INTO role_grants (id, person_id, role, scope_kind, granted_by) VALUES (${JESSE_GRANT_ID}, ${JESSE_ID}, 'admin', 'org', ${IAN_ID})`,
  );
}

async function race(dbA: Database, dbB: Database) {
  const ian = orgAdmin(IAN_ID, 'ian.lindsley@unfoldingword.org', IAN_GRANT_ID);
  const jesse = orgAdmin(JESSE_ID, 'jesse@unfoldingword.org', JESSE_GRANT_ID);
  return Promise.all([
    revokeRole(
      dbA,
      ian,
      { command: 'revoke_role', requestId: randomUUID(), grantId: JESSE_GRANT_ID },
      randomUUID(),
    ),
    revokeRole(
      dbB,
      jesse,
      { command: 'revoke_role', requestId: randomUUID(), grantId: IAN_GRANT_ID },
      randomUUID(),
    ),
  ]);
}

async function restoreBoth(db: Database): Promise<void> {
  await db.execute(
    sql`UPDATE role_grants SET revoked_at = NULL WHERE role = 'admin' AND scope_kind = 'org'`,
  );
}

describe.skipIf(!testServer)('FD-8 the last org admin survives a concurrent revoke', () => {
  it('accepts exactly one of two simultaneous revokes of each other, ten times over', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const dbA = createClient(database.connectionString);
    const dbB = createClient(database.connectionString);
    try {
      await seedJesse(dbA);
      for (let round = 0; round < ROUNDS; round += 1) {
        const results = await race(dbA, dbB);
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toEqual([
          { ok: false, reason: 'not_permitted' },
        ]);
        expect(await liveOrgAdmins(dbA)).toBe(1);
        await restoreBoth(dbA);
      }
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await database.drop();
    }
  });
});

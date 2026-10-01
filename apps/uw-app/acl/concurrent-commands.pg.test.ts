import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { personPrincipal, type Principal } from '@uw/core/principal';
import { grantRole, revokeRole } from './grant-commands.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-000000000002';
const ADMIN_GRANT_ID = '00000000-0000-4000-8000-000000000102';
const AREA = '80-89';
const ROUNDS = 30;

async function seed(db: Database): Promise<void> {
  await db.execute(
    sql`INSERT INTO people (id, email, display_name, status) VALUES (${ADMIN_ID}, 'a@unfoldingword.org', 'A', 'active')`,
  );
  await db.execute(
    sql`INSERT INTO role_grants (id, person_id, role, scope_kind, scope_area, granted_by) VALUES (${ADMIN_GRANT_ID}, ${ADMIN_ID}, 'admin', 'jd_area', ${AREA}, ${IAN_ID})`,
  );
}

type Pair = { readonly targetId: string; readonly expiredGrantId: string };

async function seedExpiredPair(db: Database): Promise<Pair> {
  const pair = {
    targetId: randomUUID(),
    expiredGrantId: `00000000-0000-4000-7000-${randomUUID().slice(-12)}`,
  };
  await db.execute(
    sql`INSERT INTO people (id, email, display_name, status) VALUES (${pair.targetId}, ${`${pair.targetId}@unfoldingword.org`}, 'T', 'active')`,
  );
  await db.execute(
    sql`INSERT INTO role_grants (id, person_id, role, scope_kind, scope_area, granted_by, expires_at) VALUES (${pair.expiredGrantId}, ${pair.targetId}, 'editor', 'jd_area', ${AREA}, ${IAN_ID}, now() - interval '1 day')`,
  );
  return pair;
}

function areaAdmin(): Principal {
  return personPrincipal({
    personId: ADMIN_ID,
    email: 'a@unfoldingword.org',
    interactive: true,
    grants: [
      {
        grantId: ADMIN_GRANT_ID,
        role: 'admin',
        scopeKind: 'jd_area',
        scopeArea: AREA,
        expiresAt: null,
      },
    ],
  });
}

function round(dbA: Database, dbB: Database, pair: Pair) {
  const grant = grantRole(
    dbA,
    areaAdmin(),
    {
      command: 'grant_role',
      requestId: randomUUID(),
      personId: pair.targetId,
      role: 'editor',
      scopeKind: 'jd_area',
      scopeArea: AREA,
      expiresAt: null,
    },
    randomUUID(),
  );
  const revoke = revokeRole(
    dbB,
    areaAdmin(),
    { command: 'revoke_role', requestId: randomUUID(), grantId: pair.expiredGrantId },
    randomUUID(),
  );
  return Promise.all([grant, revoke]);
}

describe.skipIf(!testServer)('FD-8 concurrent grant and revoke never deadlock', () => {
  it('completes an area admin grant racing a revoke of the expired duplicate', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const dbA = createClient(database.connectionString);
    const dbB = createClient(database.connectionString);
    try {
      await seed(dbA);
      for (let n = 0; n < ROUNDS; n += 1) {
        const [granted, revoked] = await round(dbA, dbB, await seedExpiredPair(dbA));
        expect(granted).toEqual({ ok: true });
        expect([{ ok: true }, { ok: false, reason: 'grant_not_found' }]).toContainEqual(revoked);
      }
    } finally {
      await dbA.$client.end();
      await dbB.$client.end();
      await database.drop();
    }
  });
});

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { personPrincipal, type Principal } from '@uw/core/principal';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { grantRole, revokeRole } from './grant-commands.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const JESSE_ID = '00000000-0000-4000-8000-000000000002';
const IAN_GRANT_ID = '00000000-0000-4000-8000-000000000101';
const JESSE_GRANT_ID = '00000000-0000-4000-8000-000000000102';

function orgAdmin(personId: string, email: string, grantId: string): Principal {
  return personPrincipal({
    personId,
    email,
    interactive: true,
    grants: [{ grantId, role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null }],
  });
}

async function seedJesse(db: Database): Promise<void> {
  await db.execute(
    sql`INSERT INTO people (id, email, display_name, status) VALUES (${JESSE_ID}, 'jesse@unfoldingword.org', 'Jesse', 'active')`,
  );
  await db.execute(
    sql`INSERT INTO role_grants (id, person_id, role, scope_kind, granted_by) VALUES (${JESSE_GRANT_ID}, ${JESSE_ID}, 'admin', 'org', ${IAN_ID})`,
  );
}

async function liveGrantCount(db: Database): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM role_grants WHERE revoked_at IS NULL`,
  );
  return rows[0]?.n ?? -1;
}

describe.skipIf(!testServer)('FD-8 a command re-checks the caller under lock', () => {
  it('refuses a grant from a principal whose org admin grant was just revoked', () =>
    withAppDatabase(async (db) => {
      await seedJesse(db);
      const staleJesse = orgAdmin(JESSE_ID, 'jesse@unfoldingword.org', JESSE_GRANT_ID);
      const ian = orgAdmin(IAN_ID, 'ian.lindsley@unfoldingword.org', IAN_GRANT_ID);
      const revoked = await revokeRole(
        db,
        ian,
        { command: 'revoke_role', requestId: randomUUID(), grantId: JESSE_GRANT_ID },
        randomUUID(),
      );
      expect(revoked).toEqual({ ok: true });
      const before = await liveGrantCount(db);
      const result = await grantRole(
        db,
        staleJesse,
        {
          command: 'grant_role',
          requestId: randomUUID(),
          personId: JESSE_ID,
          role: 'admin',
          scopeKind: 'org',
          scopeArea: null,
          expiresAt: null,
        },
        randomUUID(),
      );
      expect(result).toEqual({ ok: false, reason: 'not_permitted' });
      expect(await liveGrantCount(db)).toBe(before);
    }));
});

describe.skipIf(!testServer)('FD-8 revoke re-checks the caller under lock', () => {
  it('refuses a revoke from a principal whose org admin grant was just revoked', () =>
    withAppDatabase(async (db) => {
      await seedJesse(db);
      const staleJesse = orgAdmin(JESSE_ID, 'jesse@unfoldingword.org', JESSE_GRANT_ID);
      const ian = orgAdmin(IAN_ID, 'ian.lindsley@unfoldingword.org', IAN_GRANT_ID);
      await revokeRole(
        db,
        ian,
        { command: 'revoke_role', requestId: randomUUID(), grantId: JESSE_GRANT_ID },
        randomUUID(),
      );
      const result = await revokeRole(
        db,
        staleJesse,
        { command: 'revoke_role', requestId: randomUUID(), grantId: IAN_GRANT_ID },
        randomUUID(),
      );
      expect(result).toEqual({ ok: false, reason: 'not_permitted' });
      expect(await liveGrantCount(db)).toBe(1);
    }));
});

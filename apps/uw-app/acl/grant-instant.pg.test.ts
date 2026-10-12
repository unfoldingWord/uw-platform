import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { personPrincipal } from '@uw/core/principal';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { grantRole, revokeRole } from './grant-commands.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const IAN_GRANT_ID = '00000000-0000-4000-8000-000000000101';
const TARGET_ID = '00000000-0000-4000-8000-000000000009';
const YEAR = 365 * 24 * 60 * 60 * 1000;

const ian = personPrincipal({
  personId: IAN_ID,
  email: 'ian.lindsley@unfoldingword.org',
  interactive: true,
  grants: [
    { grantId: IAN_GRANT_ID, role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null },
  ],
});

const duplicateBody = {
  command: 'grant_role',
  requestId: randomUUID(),
  personId: TARGET_ID,
  role: 'editor',
  scopeKind: 'org',
  scopeArea: null,
  expiresAt: null,
} as const;

describe.skipIf(!testServer)('FD-8 a command judges every grant at the instant it is given', () => {
  it('closes a duplicate that expired by the given instant though the database clock says live', () =>
    withAppDatabase(async (db) => {
      await db.execute(
        sql`INSERT INTO people (id, email, display_name, status) VALUES (${TARGET_ID}, 't@unfoldingword.org', 'T', 'active')`,
      );
      await db.execute(
        sql`INSERT INTO role_grants (person_id, role, scope_kind, granted_by, expires_at) VALUES (${TARGET_ID}, 'editor', 'org', ${IAN_ID}, now() + interval '1 year')`,
      );
      const at = new Date(Date.now() + 5 * YEAR);
      const result = await grantRole(db, ian, duplicateBody, randomUUID(), at);
      expect(result).toEqual({ ok: true });
      const closed = await db.execute<{ revoked_at: string }>(
        sql`SELECT revoked_at FROM role_grants WHERE person_id = ${TARGET_ID} AND revoked_at IS NOT NULL`,
      );
      expect(new Date(closed[0]?.revoked_at ?? '').getTime()).toBe(at.getTime());
    }));

  it('stamps a revoke with the given instant', () =>
    withAppDatabase(async (db) => {
      await db.execute(
        sql`INSERT INTO people (id, email, display_name, status) VALUES (${TARGET_ID}, 't@unfoldingword.org', 'T', 'active')`,
      );
      const rows = await db.execute<{ id: string }>(
        sql`INSERT INTO role_grants (person_id, role, scope_kind, granted_by) VALUES (${TARGET_ID}, 'viewer', 'org', ${IAN_ID}) RETURNING id`,
      );
      const at = new Date(Date.now() + YEAR);
      const grantId = rows[0]?.id ?? '';
      const revoke = { command: 'revoke_role', requestId: randomUUID(), grantId } as const;
      expect(await revokeRole(db, ian, revoke, randomUUID(), at)).toEqual({ ok: true });
      const stamped = await db.execute<{ revoked_at: string }>(
        sql`SELECT revoked_at FROM role_grants WHERE id = ${grantId}`,
      );
      expect(new Date(stamped[0]?.revoked_at ?? '').getTime()).toBe(at.getTime());
    }));
});

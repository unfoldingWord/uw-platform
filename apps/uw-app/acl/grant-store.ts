import { and, asc, gt, isNull, or, eq, sql } from 'drizzle-orm';
import { grantSchema, type Grant } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { roleGrants } from '@uw/db/schema';

export function toGrant(row: typeof roleGrants.$inferSelect): Grant {
  return grantSchema.parse({
    grantId: row.id,
    role: row.role,
    scopeKind: row.scopeKind,
    scopeArea: row.scopeArea,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  });
}

export function liveGrant() {
  return and(
    isNull(roleGrants.revokedAt),
    or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, sql`now()`)),
  );
}

export async function resolveGrants(db: Executor, personId: string): Promise<Grant[]> {
  const rows = await db
    .select()
    .from(roleGrants)
    .where(and(eq(roleGrants.personId, personId), liveGrant()))
    .orderBy(asc(roleGrants.grantedAt), asc(roleGrants.id));
  return rows.map(toGrant);
}

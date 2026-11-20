import { and, eq } from 'drizzle-orm';
import type { Grant } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { grantAudit, roleGrants } from '@uw/db/schema';

const DEFAULT_READING_AREA = '00-09';

type GivenBy = { readonly actor: Principal | null; readonly traceId: string | null };

async function hasEverHeldDefaultArea(db: Executor, personId: string): Promise<boolean> {
  const rows = await db
    .select({ id: roleGrants.id })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.personId, personId),
        eq(roleGrants.scopeKind, 'jd_area'),
        eq(roleGrants.scopeArea, DEFAULT_READING_AREA),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export function readsDefaultArea(grants: readonly Grant[]): boolean {
  return grants.some(
    (grant) =>
      grant.scopeKind === 'org' ||
      (grant.scopeKind === 'jd_area' && grant.scopeArea === DEFAULT_READING_AREA),
  );
}

export async function giveDefaultReading(
  db: Executor,
  personId: string,
  by: GivenBy,
): Promise<boolean> {
  if (await hasEverHeldDefaultArea(db, personId)) return false;
  const [row] = await db
    .insert(roleGrants)
    .values({
      personId,
      role: 'viewer',
      scopeKind: 'jd_area',
      scopeArea: DEFAULT_READING_AREA,
      grantedBy: by.actor?.personId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return false;
  await db.insert(grantAudit).values({
    actor: by.actor?.identity ?? `human:${personId}`,
    action: 'default',
    grantId: row.id,
    before: null,
    after: {
      id: row.id,
      person_id: row.personId,
      role: row.role,
      scope_kind: row.scopeKind,
      scope_area: row.scopeArea,
      granted_by: row.grantedBy,
      granted_at: row.grantedAt.toISOString(),
      expires_at: null,
      revoked_at: null,
    },
    traceId: by.traceId,
  });
  return true;
}

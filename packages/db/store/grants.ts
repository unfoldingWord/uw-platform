import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import { grantSchema, type Grant } from '@uw/contracts';
import type { AnyDatabase, AnyExecutor } from '../any-database.ts';
import { roleGrants } from '../schema.ts';
import { outsideOpenTransaction } from './open-transactions.ts';
import { executorOf, type DrizzleTransaction } from './store.ts';

function toGrant(row: typeof roleGrants.$inferSelect): Grant {
  return grantSchema.parse({
    grantId: row.id,
    role: row.role,
    scopeKind: row.scopeKind,
    scopeArea: row.scopeArea,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  });
}

export function liveGrant(at: Date): SQL | undefined {
  return and(
    isNull(roleGrants.revokedAt),
    or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, at)),
  );
}

export type GrantReadOptions = { readonly at: Date; readonly lock?: 'share' };

export async function resolveGrants(
  db: AnyExecutor,
  personId: string,
  options: GrantReadOptions,
): Promise<Grant[]> {
  const query = db
    .select()
    .from(roleGrants)
    .where(and(eq(roleGrants.personId, personId), liveGrant(options.at)))
    .orderBy(asc(roleGrants.grantedAt), asc(roleGrants.id));
  const rows = options.lock === 'share' ? await query.for('share') : await query;
  return rows.map(toGrant);
}

export type DrizzleGrants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: DrizzleTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
};

export function createDrizzleGrants(db: AnyDatabase): DrizzleGrants {
  return {
    resolve: (personId, at) =>
      outsideOpenTransaction(db, 'grants.resolve', () => resolveGrants(db, personId, { at })),
    lockAndReread: (tx, personId, at) =>
      resolveGrants(executorOf(tx), personId, { at, lock: 'share' }),
  };
}

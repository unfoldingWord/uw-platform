import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import { grantSchema, type Grant, type JdArea } from '@uw/contracts';
import type { AnyDatabase, AnyExecutor } from '../any-database.ts';
import { people, roleGrants } from '../schema.ts';
import { outsideOpenTransaction } from './open-transactions.ts';
import { executorOf } from './store.ts';
import type { DrizzleTransaction } from './types.ts';

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

type GrantHolder = {
  readonly personId: string;
  readonly email: string;
  readonly grants: readonly Grant[];
};

function onArea(area: JdArea): SQL | undefined {
  return or(
    eq(roleGrants.scopeKind, 'org'),
    and(eq(roleGrants.scopeKind, 'jd_area'), eq(roleGrants.scopeArea, area)),
  );
}

async function areaHolders(db: AnyExecutor, area: JdArea, at: Date): Promise<GrantHolder[]> {
  const rows = await db
    .selectDistinct({ personId: people.id, email: people.email })
    .from(roleGrants)
    .innerJoin(people, eq(people.id, roleGrants.personId))
    .where(and(eq(people.status, 'active'), liveGrant(at), onArea(area)))
    .orderBy(asc(people.id));
  const holders: GrantHolder[] = [];
  for (const row of rows) {
    holders.push({ ...row, grants: await resolveGrants(db, row.personId, { at }) });
  }
  return holders;
}

export type DrizzleGrants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  resolveIn(tx: DrizzleTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: DrizzleTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  holders(area: JdArea, at: Date): Promise<readonly GrantHolder[]>;
};

export function createDrizzleGrants(db: AnyDatabase): DrizzleGrants {
  return {
    resolve: (personId, at) =>
      outsideOpenTransaction(db, 'grants.resolve', () => resolveGrants(db, personId, { at })),
    resolveIn: (tx, personId, at) => resolveGrants(executorOf(tx), personId, { at }),
    lockAndReread: (tx, personId, at) =>
      resolveGrants(executorOf(tx), personId, { at, lock: 'share' }),
    holders: (area, at) =>
      outsideOpenTransaction(db, 'grants.holders', () => areaHolders(db, area, at)),
  };
}

import { and, asc, desc, eq, gt, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { delegations } from '../schema.ts';
import { checkedRows } from './limits.ts';
import { refusing } from './refusal.ts';
import { toDelegation } from './rows.ts';
import type { DelegationFilter, DelegationsGateway } from './types.ts';

function matching(filter: DelegationFilter, at: Date): SQL | undefined {
  return and(
    isNull(delegations.revokedAt),
    isNull(delegations.lapsedAt),
    gt(delegations.expiresAt, at),
    filter.personId === null ? undefined : eq(delegations.personId, filter.personId),
    filter.persona === null ? undefined : eq(delegations.persona, filter.persona),
    filter.harnessId === null ? undefined : eq(delegations.harnessId, filter.harnessId),
  );
}

async function stamp(
  executor: AnyExecutor,
  delegationId: string,
  column: 'revokedAt' | 'lapsedAt',
  at: Date,
): Promise<boolean> {
  const values = column === 'revokedAt' ? { revokedAt: at } : { lapsedAt: at };
  const unset = column === 'revokedAt' ? delegations.revokedAt : delegations.lapsedAt;
  const rows = await executor
    .update(delegations)
    .set(values)
    .where(and(eq(delegations.id, delegationId), isNull(unset)))
    .returning({ id: delegations.id });
  return rows.length === 1;
}

const endedAt = sql`coalesce(${delegations.lapsedAt}, ${delegations.expiresAt})`;

async function lapsedFor(
  executor: AnyExecutor,
  personId: string,
  since: Date,
  at: Date,
  limit: number,
) {
  const rows = await executor
    .select()
    .from(delegations)
    .where(
      and(
        eq(delegations.personId, personId),
        isNull(delegations.revokedAt),
        sql`${endedAt} >= ${since.toISOString()}::timestamptz`,
        sql`${endedAt} <= ${at.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(endedAt), asc(delegations.id))
    .limit(checkedRows(limit, 'lapsed delegation'));
  return rows.map(toDelegation);
}

async function expiredUnlapsed(executor: AnyExecutor, at: Date, limit: number) {
  const rows = await executor
    .select()
    .from(delegations)
    .where(
      and(
        isNull(delegations.revokedAt),
        isNull(delegations.lapsedAt),
        lte(delegations.expiresAt, at),
      ),
    )
    .orderBy(asc(delegations.expiresAt), asc(delegations.id))
    .limit(checkedRows(limit, 'expired delegation'));
  return rows.map(toDelegation);
}

export function bindDelegations(executor: AnyExecutor): DelegationsGateway {
  return {
    read: {
      byId: async (delegationId) => {
        const rows = await executor
          .select()
          .from(delegations)
          .where(eq(delegations.id, delegationId));
        return rows[0] ? toDelegation(rows[0]) : null;
      },
      live: async (filter, at) => {
        const rows = await executor
          .select()
          .from(delegations)
          .where(matching(filter, at))
          .orderBy(asc(delegations.grantedAt), asc(delegations.id));
        return rows.map(toDelegation);
      },
      lapsedFor: (personId, since, at, limit) => lapsedFor(executor, personId, since, at, limit),
      expiredUnlapsed: (at, limit) => expiredUnlapsed(executor, at, limit),
    },
    write: {
      insert: (delegation, traceId) =>
        refusing(async () => {
          await executor.insert(delegations).values({ ...delegation, traceId });
        }),
      revoke: (delegationId, at) => stamp(executor, delegationId, 'revokedAt', at),
      markLapsed: (delegationId, at) => stamp(executor, delegationId, 'lapsedAt', at),
    },
  };
}

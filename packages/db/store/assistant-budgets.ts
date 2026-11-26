import { eq, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantBudgets, delegations, harnesses } from '../schema.ts';
import { refusing } from './refusal.ts';
import type { AssistantBudgetRow, AssistantBudgetsGateway, AssistantPoolBudgets } from './types.ts';

async function of(executor: AnyExecutor, harnessId: string): Promise<AssistantBudgetRow | null> {
  const rows = await executor
    .select()
    .from(assistantBudgets)
    .where(eq(assistantBudgets.harnessId, harnessId));
  return rows[0] ? { ...rows[0] } : null;
}

function counted(value: unknown): number {
  const counted = Number(value ?? 0);
  if (!Number.isSafeInteger(counted)) throw new RangeError('an assistant pool count is not exact');
  return counted;
}

async function pool(executor: AnyExecutor, at: Date): Promise<AssistantPoolBudgets> {
  const liveAssist = sql`EXISTS (
    SELECT 1 FROM ${delegations}
    WHERE ${delegations.harnessId} = ${harnesses.id}
      AND ${delegations.personId} = ${harnesses.personId}
      AND ${delegations.capability} = 'assist'
      AND ${delegations.revokedAt} IS NULL
      AND ${delegations.lapsedAt} IS NULL
      AND ${delegations.expiresAt} > ${at.toISOString()}::timestamptz)`;
  const [row] = await executor
    .select({
      enabled: sql<string>`count(*)::text`,
      overridden: sql<string>`count(${assistantBudgets.harnessId})::text`,
      overriddenMinor: sql<string>`COALESCE(SUM(${assistantBudgets.monthlyMinor}), 0)::text`,
    })
    .from(harnesses)
    .leftJoin(assistantBudgets, eq(assistantBudgets.harnessId, harnesses.id))
    .where(sql`${harnesses.personId} IS NOT NULL AND ${liveAssist}`);
  return {
    enabled: counted(row?.enabled),
    overridden: counted(row?.overridden),
    overriddenMinor: counted(row?.overriddenMinor),
  };
}

async function put(executor: AnyExecutor, row: AssistantBudgetRow): Promise<void> {
  await executor
    .insert(assistantBudgets)
    .values({ ...row })
    .onConflictDoUpdate({
      target: assistantBudgets.harnessId,
      set: { monthlyMinor: row.monthlyMinor, setBy: row.setBy, setAt: row.setAt },
    });
}

async function remove(executor: AnyExecutor, harnessId: string): Promise<void> {
  await executor.delete(assistantBudgets).where(eq(assistantBudgets.harnessId, harnessId));
}

export function bindAssistantBudgets(executor: AnyExecutor): AssistantBudgetsGateway {
  return {
    read: {
      of: (harnessId) => of(executor, harnessId),
      pool: (at) => pool(executor, at),
    },
    write: {
      put: (row) => refusing(() => put(executor, row)),
      remove: (harnessId) => refusing(() => remove(executor, harnessId)),
    },
  };
}

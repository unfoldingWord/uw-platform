import { ASSISTANT_JD_CATEGORY, assistantAccountStatusSchema, jdIdOfTitle } from '@uw/contracts';
import { and, asc, eq, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantAccounts, pages, people } from '../schema.ts';
import { refusing } from './refusal.ts';
import type { AssistantAccountRow, AssistantAccountsGateway } from './types.ts';

const READ_MOST = 200;

function toAccount(row: typeof assistantAccounts.$inferSelect): AssistantAccountRow {
  return { ...row, status: assistantAccountStatusSchema.parse(row.status) };
}

function bounded(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > READ_MOST) {
    throw new RangeError(`an account read holds 1 to ${READ_MOST} accounts, not ${limit}`);
  }
  return limit;
}

async function one(executor: AnyExecutor, where: ReturnType<typeof eq>) {
  const rows = await executor.select().from(assistantAccounts).where(where);
  return rows[0] ? toAccount(rows[0]) : null;
}

async function nameHolder(executor: AnyExecutor, name: string): Promise<string | null> {
  const rows = await executor
    .select({ harnessId: assistantAccounts.harnessId })
    .from(assistantAccounts)
    .where(and(eq(assistantAccounts.name, name), ne(assistantAccounts.status, 'deleted')));
  return rows[0]?.harnessId ?? null;
}

async function pageJdIds(executor: AnyExecutor): Promise<readonly string[]> {
  const category = ASSISTANT_JD_CATEGORY;
  const rows = await executor
    .select({ jdId: sql<string | null>`${pages.frontmatter}->>'jd_id'`, title: pages.title })
    .from(pages)
    .where(
      and(
        or(
          sql`${pages.frontmatter}->>'jd_category' = ${category}`,
          sql`${pages.title} ~ ${`^\\s*${category}\\.`}`,
        ),
        ne(pages.status, 'retired'),
      ),
    );
  return rows.flatMap((row) => [row.jdId, jdIdOfTitle(row.title)].filter((id) => id !== null));
}

async function takenJdIds(executor: AnyExecutor): Promise<readonly string[]> {
  const rows = await executor
    .select({ jdId: assistantAccounts.jdId })
    .from(assistantAccounts)
    .where(isNotNull(assistantAccounts.jdId));
  const held = rows.flatMap((row) => (row.jdId === null ? [] : [row.jdId]));
  return [...new Set([...held, ...(await pageJdIds(executor))])].sort();
}

async function disabledBefore(executor: AnyExecutor, before: Date, limit: number) {
  const rows = await executor
    .select()
    .from(assistantAccounts)
    .where(and(eq(assistantAccounts.status, 'disabled'), lte(assistantAccounts.disabledAt, before)))
    .orderBy(asc(assistantAccounts.disabledAt), asc(assistantAccounts.harnessId))
    .limit(bounded(limit));
  return rows.map(toAccount);
}

async function leavers(executor: AnyExecutor, limit: number) {
  const rows = await executor
    .select({ account: assistantAccounts })
    .from(assistantAccounts)
    .innerJoin(people, eq(people.id, assistantAccounts.personId))
    .where(and(eq(assistantAccounts.status, 'enabled'), ne(people.status, 'active')))
    .orderBy(asc(assistantAccounts.updatedAt), asc(assistantAccounts.harnessId))
    .limit(bounded(limit));
  return rows.map((row) => toAccount(row.account));
}

async function update(executor: AnyExecutor, row: AssistantAccountRow, expected: number) {
  const { name, jdId, status, disabledAt, deletedAt, version, updatedAt } = row;
  const updated = await executor
    .update(assistantAccounts)
    .set({ name, jdId, status, disabledAt, deletedAt, version, updatedAt })
    .where(
      and(
        eq(assistantAccounts.harnessId, row.harnessId),
        eq(assistantAccounts.personId, row.personId),
        eq(assistantAccounts.version, expected),
      ),
    )
    .returning({ harnessId: assistantAccounts.harnessId });
  return updated.length === 1;
}

export function bindAssistantAccounts(executor: AnyExecutor): AssistantAccountsGateway {
  return {
    read: {
      byPerson: (personId) => one(executor, eq(assistantAccounts.personId, personId)),
      byHarness: (harnessId) => one(executor, eq(assistantAccounts.harnessId, harnessId)),
      nameHolder: (name) => nameHolder(executor, name),
      takenJdIds: () => takenJdIds(executor),
      disabledBefore: (before, limit) => disabledBefore(executor, before, limit),
      leavers: (limit) => leavers(executor, limit),
    },
    write: {
      insert: (row) =>
        refusing(async () => {
          await executor.insert(assistantAccounts).values({ ...row });
        }),
      update: (row, expected) => refusing(() => update(executor, row, expected)),
    },
  };
}

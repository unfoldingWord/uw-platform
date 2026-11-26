import { repositorySchema, type Harness } from '@uw/contracts';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { harnesses } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toHarness } from './rows.ts';
import type { HarnessesGateway } from './types.ts';

async function firstWhere(executor: AnyExecutor, condition: SQL): Promise<Harness | null> {
  const rows = await executor.select().from(harnesses).where(condition);
  return rows[0] ? toHarness(rows[0]) : null;
}

function updateHarness(
  executor: AnyExecutor,
  harnessId: string,
  change: Partial<typeof harnesses.$inferInsert>,
): Promise<boolean> {
  return refusing(async () => {
    const rows = await executor
      .update(harnesses)
      .set(change)
      .where(eq(harnesses.id, harnessId))
      .returning({ id: harnesses.id });
    return rows.length > 0;
  });
}

export function bindHarnesses(executor: AnyExecutor): HarnessesGateway {
  return {
    read: {
      byId: (harnessId) => firstWhere(executor, eq(harnesses.id, harnessId)),
      byKey: (key) => firstWhere(executor, eq(harnesses.key, key)),
      byRepository: async (repository) => {
        if (!repositorySchema.safeParse(repository).success) return null;
        return firstWhere(executor, sql`lower(${harnesses.repository}) = lower(${repository})`);
      },
      byPerson: (personId) => firstWhere(executor, eq(harnesses.personId, personId)),
      list: async () => {
        const rows = await executor.select().from(harnesses).orderBy(asc(harnesses.key));
        return rows.map(toHarness);
      },
    },
    write: {
      insert: (harness, at) =>
        refusing(async () => {
          await executor.insert(harnesses).values({ ...harness, createdAt: at });
        }),
      setPaused: (harnessId, paused) => updateHarness(executor, harnessId, { paused }),
      setHostedBuilder: (harnessId, enabled) =>
        updateHarness(executor, harnessId, { hostedBuilderEnabled: enabled }),
      setShadow: (harnessId, shadow) => updateHarness(executor, harnessId, { shadow }),
      setFixClaim: (harnessId, enabled) =>
        updateHarness(executor, harnessId, { fixClaim: enabled }),
      setTitle: (harnessId, title) => updateHarness(executor, harnessId, { title }),
      setTemplate: (harnessId, from, to) =>
        refusing(async () => {
          const rows = await executor
            .update(harnesses)
            .set({ template: to })
            .where(and(eq(harnesses.id, harnessId), eq(harnesses.template, from)))
            .returning({ id: harnesses.id });
          return rows.length > 0;
        }),
      setFreeze: (harnessId, frozen, allow) =>
        updateHarness(executor, harnessId, { frozen, freezeAllow: [...allow] }),
    },
  };
}

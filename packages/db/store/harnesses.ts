import { repositorySchema } from '@uw/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { harnesses } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toHarness } from './rows.ts';
import type { HarnessesGateway } from './types.ts';

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
      byId: async (harnessId) => {
        const rows = await executor.select().from(harnesses).where(eq(harnesses.id, harnessId));
        return rows[0] ? toHarness(rows[0]) : null;
      },
      byKey: async (key) => {
        const rows = await executor.select().from(harnesses).where(eq(harnesses.key, key));
        return rows[0] ? toHarness(rows[0]) : null;
      },
      byRepository: async (repository) => {
        if (!repositorySchema.safeParse(repository).success) return null;
        const rows = await executor
          .select()
          .from(harnesses)
          .where(sql`lower(${harnesses.repository}) = lower(${repository})`);
        return rows[0] ? toHarness(rows[0]) : null;
      },
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
    },
  };
}

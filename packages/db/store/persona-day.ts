import { and, asc, count, eq, gte, sql } from 'drizzle-orm';
import { engineSchema, runShapeSchema } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { harnessRuns } from '../schema.ts';
import { completedWith } from './events.ts';
import type { PersonaDay, PersonaDayQuery, RunCount } from './types.ts';

const stepTokens = sql`(SELECT coalesce(sum((step->>'tokensIn')::bigint + (step->>'tokensOut')::bigint), 0) FROM jsonb_array_elements(${harnessRuns.steps}) AS step)`;
const stepWrites = sql`(SELECT coalesce(sum((step->>'writes')::bigint), 0) FROM jsonb_array_elements(${harnessRuns.steps}) AS step)`;
const escalatedResult = completedWith(harnessRuns, ['premise_held', 'review_refused']);

function persona(query: PersonaDayQuery) {
  return and(eq(harnessRuns.persona, query.identity), eq(harnessRuns.harnessId, query.harnessId));
}

async function countsOf(executor: AnyExecutor, query: PersonaDayQuery): Promise<RunCount[]> {
  const rows = await executor
    .select({ runShape: harnessRuns.runShape, engine: harnessRuns.engine, count: count() })
    .from(harnessRuns)
    .where(and(persona(query), gte(harnessRuns.startedAt, query.since)))
    .groupBy(harnessRuns.runShape, harnessRuns.engine)
    .orderBy(asc(harnessRuns.runShape), asc(harnessRuns.engine));
  return rows.map((row) => ({
    runShape: runShapeSchema.parse(row.runShape),
    engine: engineSchema.parse(row.engine),
    count: row.count,
  }));
}

async function spendOf(executor: AnyExecutor, query: PersonaDayQuery) {
  const metered = sql`${harnessRuns.costBasis} = 'metered'`;
  const subscription = sql`${harnessRuns.costBasis} = 'subscription'`;
  const [row] = await executor
    .select({
      meteredMinor:
        sql`coalesce(sum(${harnessRuns.costMinor}) FILTER (WHERE ${metered}), 0)`.mapWith(Number),
      computeMinor:
        sql`coalesce(sum(${harnessRuns.computeMinor}) FILTER (WHERE ${metered}), 0)`.mapWith(
          Number,
        ),
      subscriptionTokens:
        sql`coalesce(sum(${stepTokens}) FILTER (WHERE ${subscription}), 0)`.mapWith(Number),
      writes: sql`coalesce(sum(${stepWrites}), 0)`.mapWith(Number),
    })
    .from(harnessRuns)
    .where(and(persona(query), gte(harnessRuns.startedAt, query.since)));
  return row ?? { meteredMinor: 0, computeMinor: 0, subscriptionTokens: 0, writes: 0 };
}

async function endingsOf(executor: AnyExecutor, query: PersonaDayQuery) {
  const failed = sql`${harnessRuns.outcome} = 'failed'`;
  const [row] = await executor
    .select({
      ended: count(),
      escalated: sql`count(*) FILTER (WHERE ${failed} OR ${escalatedResult})`.mapWith(Number),
    })
    .from(harnessRuns)
    .where(and(persona(query), gte(harnessRuns.endedAt, query.since)));
  return row ?? { ended: 0, escalated: 0 };
}

export async function personaDay(
  executor: AnyExecutor,
  query: PersonaDayQuery,
): Promise<PersonaDay> {
  return {
    counts: await countsOf(executor, query),
    ...(await spendOf(executor, query)),
    ...(await endingsOf(executor, query)),
  };
}

import { and, asc, count, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { engineSchema, runShapeSchema } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { oneOf } from '../checks.ts';
import { delegations, harnessItems, harnessRuns } from '../schema.ts';
import { personaDay } from './persona-day.ts';
import { refusing } from './refusal.ts';
import { toRun } from './rows.ts';
import type {
  HarnessRunsGateway,
  ItemCost,
  PersonaRunQuery,
  RunCount,
  RunRow,
  RunSpend,
} from './types.ts';

const liveOutcomes = ['running', 'hibernated'];

function mutableColumnsOf(run: RunRow) {
  return {
    resolvedProvider: run.resolvedProvider,
    steps: [...run.steps],
    costMinor: run.costMinor,
    computeMinor: run.computeMinor,
    outcome: run.outcome,
    hibernatedFor: run.hibernatedFor,
    failure: run.failure,
    gates: [...run.gates],
    prompts: [...run.prompts],
    endedAt: run.endedAt,
  };
}

export function runsQuery(executor: AnyExecutor, where: SQL | undefined) {
  return executor.select().from(harnessRuns).where(where).orderBy(asc(harnessRuns.id));
}

export function liveRuns(scope: { readonly harnessId?: string | null; readonly itemId?: string }) {
  return and(
    oneOf(harnessRuns.outcome, liveOutcomes),
    scope.harnessId === undefined || scope.harnessId === null
      ? undefined
      : eq(harnessRuns.harnessId, scope.harnessId),
    scope.itemId === undefined ? undefined : eq(harnessRuns.itemId, scope.itemId),
  );
}

async function runsWhere(executor: AnyExecutor, where: SQL | undefined): Promise<RunRow[]> {
  return (await runsQuery(executor, where)).map(toRun);
}

async function firstWhere(executor: AnyExecutor, where: SQL | undefined): Promise<RunRow | null> {
  return (await runsWhere(executor, where))[0] ?? null;
}

async function lock(executor: AnyExecutor, runId: string): Promise<RunRow | null> {
  const locked = await executor
    .select({ id: harnessRuns.id })
    .from(harnessRuns)
    .where(eq(harnessRuns.id, runId))
    .for('update');
  if (locked.length === 0) return null;
  return firstWhere(executor, eq(harnessRuns.id, runId));
}

async function update(executor: AnyExecutor, run: RunRow): Promise<boolean> {
  const rows = await executor
    .update(harnessRuns)
    .set(mutableColumnsOf(run))
    .where(eq(harnessRuns.id, run.id))
    .returning({ id: harnessRuns.id });
  return rows.length === 1;
}

const maxRuns = 5000;

function checkedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxRuns) {
    throw new RangeError(`a run read holds 1 to ${maxRuns} runs, not ${limit}`);
  }
  return limit;
}

async function forItems(executor: AnyExecutor, itemIds: readonly string[]): Promise<RunRow[]> {
  if (itemIds.length === 0) return [];
  const rows = await executor
    .select()
    .from(harnessRuns)
    .where(inArray(harnessRuns.itemId, [...itemIds]))
    .orderBy(asc(harnessRuns.startedAt), asc(harnessRuns.id));
  return rows.map(toRun);
}

export function startedSinceQuery(executor: AnyExecutor, since: Date, limit: number) {
  return executor
    .select()
    .from(harnessRuns)
    .where(gte(harnessRuns.startedAt, since))
    .orderBy(asc(harnessRuns.startedAt), asc(harnessRuns.id))
    .limit(checkedLimit(limit));
}

async function forPersona(executor: AnyExecutor, query: PersonaRunQuery): Promise<RunRow[]> {
  const rows = await executor
    .select()
    .from(harnessRuns)
    .where(
      and(
        eq(harnessRuns.persona, query.identity),
        eq(harnessRuns.harnessId, query.harnessId),
        query.since === null ? undefined : gte(harnessRuns.startedAt, query.since),
      ),
    )
    .orderBy(desc(harnessRuns.startedAt), asc(harnessRuns.id))
    .limit(checkedLimit(query.limit));
  return rows.map(toRun);
}

function ownedBy(personId: string): SQL {
  const human = `human:${personId}`;
  const device = `agent:${personId}/`;
  return sql`(${harnessRuns.persona} = ${human}
    OR starts_with(${harnessRuns.persona}, ${device})
    OR EXISTS (SELECT 1 FROM ${delegations} WHERE ${delegations.id} = ${harnessRuns.delegationId} AND ${delegations.personId} = ${personId})
    OR EXISTS (SELECT 1 FROM ${harnessItems} WHERE ${harnessItems.id} = ${harnessRuns.itemId} AND (${harnessItems.claimedBy} = ${human} OR starts_with(${harnessItems.claimedBy}, ${device}))))`;
}

const notRetried = sql`NOT EXISTS (SELECT 1 FROM harness_runs AS later_run WHERE later_run.item_id = ${harnessRuns.itemId} AND later_run.started_at > coalesce(${harnessRuns.endedAt}, ${harnessRuns.startedAt}))`;

type FailedForInput = {
  readonly personId: string;
  readonly harnessIds: readonly string[];
  readonly since: Date;
  readonly limit: number;
};

export function failedForQuery(executor: AnyExecutor, input: FailedForInput) {
  return executor
    .select()
    .from(harnessRuns)
    .where(
      and(
        eq(harnessRuns.outcome, 'failed'),
        gte(harnessRuns.endedAt, input.since),
        inArray(harnessRuns.harnessId, [...input.harnessIds]),
        ownedBy(input.personId),
        notRetried,
      ),
    )
    .orderBy(desc(harnessRuns.endedAt), asc(harnessRuns.id))
    .limit(checkedLimit(input.limit));
}

async function failedFor(executor: AnyExecutor, input: FailedForInput): Promise<RunRow[]> {
  checkedLimit(input.limit);
  if (input.harnessIds.length === 0) return [];
  return (await failedForQuery(executor, input)).map(toRun);
}

const stepTokens = sql`(SELECT coalesce(sum((step->>'tokensIn')::bigint + (step->>'tokensOut')::bigint), 0) FROM jsonb_array_elements(${harnessRuns.steps}) AS step)`;

async function spendSince(executor: AnyExecutor, since: Date): Promise<RunSpend> {
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
    })
    .from(harnessRuns)
    .where(gte(harnessRuns.startedAt, since));
  return row ?? { meteredMinor: 0, computeMinor: 0, subscriptionTokens: 0 };
}

async function costsByItem(
  executor: AnyExecutor,
  itemIds: readonly string[],
): Promise<readonly ItemCost[]> {
  if (itemIds.length === 0) return [];
  const metered = sql`${harnessRuns.costBasis} = 'metered'`;
  const subscription = sql`${harnessRuns.costBasis} = 'subscription'`;
  return executor
    .select({
      itemId: harnessRuns.itemId,
      meteredMinor:
        sql`coalesce(sum(${harnessRuns.costMinor}) FILTER (WHERE ${metered}), 0)`.mapWith(Number),
      computeMinor:
        sql`coalesce(sum(${harnessRuns.computeMinor}) FILTER (WHERE ${metered}), 0)`.mapWith(
          Number,
        ),
      meteredTokens: sql`coalesce(sum(${stepTokens}) FILTER (WHERE ${metered}), 0)`.mapWith(Number),
      subscriptionTokens:
        sql`coalesce(sum(${stepTokens}) FILTER (WHERE ${subscription}), 0)`.mapWith(Number),
    })
    .from(harnessRuns)
    .where(inArray(harnessRuns.itemId, [...itemIds]))
    .groupBy(harnessRuns.itemId)
    .orderBy(asc(harnessRuns.itemId));
}

async function runCountsSince(executor: AnyExecutor, since: Date): Promise<readonly RunCount[]> {
  const rows = await executor
    .select({ runShape: harnessRuns.runShape, engine: harnessRuns.engine, count: count() })
    .from(harnessRuns)
    .where(gte(harnessRuns.startedAt, since))
    .groupBy(harnessRuns.runShape, harnessRuns.engine)
    .orderBy(asc(harnessRuns.runShape), asc(harnessRuns.engine));
  return rows.map((row) => ({
    runShape: runShapeSchema.parse(row.runShape),
    engine: engineSchema.parse(row.engine),
    count: row.count,
  }));
}

export function bindRuns(executor: AnyExecutor): HarnessRunsGateway {
  return {
    read: {
      byId: (runId) => firstWhere(executor, eq(harnessRuns.id, runId)),
      lock: (runId) => lock(executor, runId),
      liveForItem: (itemId) => firstWhere(executor, liveRuns({ itemId })),
      live: (harnessId) => runsWhere(executor, liveRuns({ harnessId })),
      forItems: (itemIds) => forItems(executor, itemIds),
      startedSince: async (since, limit) =>
        (await startedSinceQuery(executor, since, limit)).map(toRun),
      failedFor: (personId, harnessIds, since, limit) =>
        failedFor(executor, { personId, harnessIds, since, limit }),
      spendSince: (since) => spendSince(executor, since),
      runCountsSince: (since) => runCountsSince(executor, since),
      costsByItem: (itemIds) => costsByItem(executor, itemIds),
      forPersona: (query) => forPersona(executor, query),
      personaDay: (query) => personaDay(executor, query),
    },
    write: {
      insert: (run) =>
        refusing(async () => {
          await executor.insert(harnessRuns).values({
            ...run,
            steps: [...run.steps],
            gates: [...run.gates],
            prompts: [...run.prompts],
          });
        }),
      update: (run) => refusing(() => update(executor, run)),
    },
  };
}

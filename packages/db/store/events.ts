import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  max,
  notLike,
  or,
  sql,
  type Column,
  type SQL,
} from 'drizzle-orm';
import {
  eventNameSchema,
  personaSlugSchema,
  type EventName,
  type HarnessEvent,
  type NewHarnessEvent,
} from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { oneOf } from '../checks.ts';
import { harnessEvents } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toEvent } from './rows.ts';
import type {
  BreakerEventName,
  EventPage,
  EventQuery,
  HarnessEventsGateway,
  HarnessPosition,
  PersonaEventCount,
  RecentEvents,
  StageEntry,
} from './types.ts';

const maxPage = 100;
const maxRecent = 5000;
const stageEntryNames = ['item_created', 'stage_advanced', 'loop_edge_taken'];

export function bindEvents(executor: AnyExecutor): HarnessEventsGateway {
  return {
    read: {
      page: (query) => page(executor, query),
      createdFor: (actor, requestId) => createdFor(executor, actor, requestId),
      latestNamed: (names, harnessId) => latestNamed(executor, names, harnessId),
      enteredStage: (harnessId, itemIds) => enteredStage(executor, harnessId, itemIds),
      recent: (query) => recent(executor, query),
      lastPosition: (harnessId) => lastPosition(executor, harnessId),
      lastPositions: (harnessIds) => lastPositions(executor, harnessIds),
      countForPersona: (query) => countForPersona(executor, query),
    },
    write: { append: (events) => refusing(() => appendAll(executor, events)) },
  };
}

async function appendAll(
  executor: AnyExecutor,
  events: readonly NewHarnessEvent[],
): Promise<readonly HarnessEvent[]> {
  const stored: HarnessEvent[] = [];
  for (const event of events) {
    const [row] = await executor
      .insert(harnessEvents)
      .values({
        id: event.eventId,
        harnessId: event.harnessId,
        itemId: event.itemId,
        name: event.name,
        actor: event.actor,
        evidence: event.evidence,
        traceId: event.traceId,
        requestId: event.requestId,
        at: new Date(event.at),
      })
      .returning();
    if (!row) throw new Error(`the store returned no row for event ${event.eventId}`);
    stored.push(toEvent(row));
  }
  return stored;
}

async function page(executor: AnyExecutor, query: EventQuery): Promise<EventPage> {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > maxPage) {
    throw new RangeError(`an event page holds 1 to ${maxPage} events, not ${query.limit}`);
  }
  if (!Number.isInteger(query.after) || query.after < 0) {
    throw new RangeError(`an event cursor is a position of 0 or more, not ${query.after}`);
  }
  const inScope = and(
    eq(harnessEvents.harnessId, query.harnessId),
    gt(harnessEvents.position, query.after),
    query.itemId === null ? undefined : eq(harnessEvents.itemId, query.itemId),
  );
  const rows = await executor
    .select()
    .from(harnessEvents)
    .where(inScope)
    .orderBy(asc(harnessEvents.position))
    .limit(query.limit);
  const events = rows.map(toEvent);
  const last = events.at(-1);
  return {
    events,
    next: last !== undefined && events.length === query.limit ? last.position : null,
  };
}

async function createdFor(
  executor: AnyExecutor,
  actor: string,
  requestId: string,
): Promise<string | null> {
  const rows = await executor
    .select({ itemId: harnessEvents.itemId })
    .from(harnessEvents)
    .where(
      and(
        eq(harnessEvents.actor, actor),
        eq(harnessEvents.requestId, requestId),
        eq(harnessEvents.name, 'item_created'),
        isNotNull(harnessEvents.itemId),
      ),
    )
    .limit(1);
  return rows[0]?.itemId ?? null;
}

export function latestNamedQuery(
  executor: AnyExecutor,
  names: readonly BreakerEventName[],
  harnessId: string | null,
) {
  return executor
    .select()
    .from(harnessEvents)
    .where(
      and(
        oneOf(harnessEvents.name, names),
        harnessId === null ? undefined : eq(harnessEvents.harnessId, harnessId),
      ),
    )
    .orderBy(desc(harnessEvents.at), asc(harnessEvents.harnessId), desc(harnessEvents.position))
    .limit(1);
}

async function latestNamed(
  executor: AnyExecutor,
  names: readonly BreakerEventName[],
  harnessId: string | null,
): Promise<HarnessEvent | null> {
  if (names.length === 0) return null;
  const [row] = await latestNamedQuery(executor, names, harnessId);
  return row ? toEvent(row) : null;
}

async function enteredStage(
  executor: AnyExecutor,
  harnessId: string,
  itemIds: readonly string[],
): Promise<readonly StageEntry[]> {
  if (itemIds.length === 0) return [];
  const rows = await executor
    .selectDistinctOn([harnessEvents.itemId], {
      itemId: harnessEvents.itemId,
      at: harnessEvents.at,
    })
    .from(harnessEvents)
    .where(
      and(
        eq(harnessEvents.harnessId, harnessId),
        inArray(harnessEvents.itemId, [...itemIds]),
        inArray(harnessEvents.name, stageEntryNames),
      ),
    )
    .orderBy(asc(harnessEvents.itemId), desc(harnessEvents.position));
  return rows.flatMap((row) => (row.itemId === null ? [] : [{ itemId: row.itemId, at: row.at }]));
}

export function recentQuery(executor: AnyExecutor, query: RecentEvents) {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > maxRecent) {
    throw new RangeError(`a recent read holds 1 to ${maxRecent} events, not ${query.limit}`);
  }
  return executor
    .select()
    .from(harnessEvents)
    .where(
      and(
        gte(harnessEvents.at, query.since),
        query.names === null ? undefined : inArray(harnessEvents.name, [...query.names]),
        query.agentsOnly ? notLike(harnessEvents.actor, 'human:%') : undefined,
        query.harnessIds === undefined || query.harnessIds.length === 0
          ? undefined
          : inArray(harnessEvents.harnessId, [...query.harnessIds]),
        query.evidencePerson === undefined
          ? undefined
          : sql`${harnessEvents.evidence}->>'personId' = ${query.evidencePerson}`,
      ),
    )
    .orderBy(desc(harnessEvents.at), asc(harnessEvents.harnessId), desc(harnessEvents.position))
    .limit(query.limit);
}

async function recent(
  executor: AnyExecutor,
  query: RecentEvents,
): Promise<readonly HarnessEvent[]> {
  const rows = recentQuery(executor, query);
  if (query.names !== null && query.names.length === 0) return [];
  if (query.harnessIds?.length === 0) return [];
  return (await rows).map(toEvent);
}

async function lastPosition(executor: AnyExecutor, harnessId: string): Promise<number> {
  const [row] = await executor
    .select({ last: max(harnessEvents.position) })
    .from(harnessEvents)
    .where(eq(harnessEvents.harnessId, harnessId));
  return row?.last ?? 0;
}

async function lastPositions(
  executor: AnyExecutor,
  harnessIds: readonly string[],
): Promise<readonly HarnessPosition[]> {
  if (harnessIds.length === 0) return [];
  const rows = await executor
    .select({ harnessId: harnessEvents.harnessId, position: max(harnessEvents.position) })
    .from(harnessEvents)
    .where(inArray(harnessEvents.harnessId, [...harnessIds]))
    .groupBy(harnessEvents.harnessId)
    .orderBy(asc(harnessEvents.harnessId));
  return rows.flatMap((row) =>
    row.position === null ? [] : [{ harnessId: row.harnessId, position: row.position }],
  );
}

type RunColumns = { readonly id: Column; readonly harnessId: Column; readonly itemId: Column };

export function completedWith(run: RunColumns, results: readonly string[]): SQL {
  const named = sql.join(
    results.map((result) => sql`${result}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM ${harnessEvents} WHERE ${harnessEvents.harnessId} = ${run.harnessId} AND ${harnessEvents.itemId} = ${run.itemId} AND ${harnessEvents.name} = 'run_completed' AND ${harnessEvents.evidence}->>'runId' = ${run.id}::text AND ${harnessEvents.evidence}->>'result' IN (${named}))`;
}

async function countForPersona(
  executor: AnyExecutor,
  query: PersonaEventCount,
): Promise<ReadonlyMap<EventName, number>> {
  const slug = personaSlugSchema.safeParse(query.personaSlug);
  if (!slug.success || query.names.length === 0) return new Map();
  const delegated = `^agent:[^ ]+ as ${slug.data} via delegation:[0-9a-f-]{36}$`;
  const rows = await executor
    .select({ name: harnessEvents.name, count: count() })
    .from(harnessEvents)
    .where(
      and(
        eq(harnessEvents.harnessId, query.harnessId),
        gte(harnessEvents.at, query.since),
        inArray(harnessEvents.name, [...query.names]),
        or(
          eq(harnessEvents.actor, `agent:${slug.data}`),
          sql`${harnessEvents.actor} ~ ${delegated}`,
        ),
      ),
    )
    .groupBy(harnessEvents.name);
  return new Map(rows.map((row) => [eventNameSchema.parse(row.name), row.count]));
}

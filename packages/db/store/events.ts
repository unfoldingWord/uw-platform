import { and, asc, desc, eq, gt, isNotNull } from 'drizzle-orm';
import type { HarnessEvent, NewHarnessEvent } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { oneOf } from '../checks.ts';
import { harnessEvents } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toEvent } from './rows.ts';
import type { BreakerEventName, EventPage, EventQuery, HarnessEventsGateway } from './types.ts';

const maxPage = 100;

export function bindEvents(executor: AnyExecutor): HarnessEventsGateway {
  return {
    read: {
      page: (query) => page(executor, query),
      createdFor: (actor, requestId) => createdFor(executor, actor, requestId),
      latestNamed: (names, harnessId) => latestNamed(executor, names, harnessId),
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

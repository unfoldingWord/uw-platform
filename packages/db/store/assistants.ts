import {
  assistantChannelSchema,
  assistantEffectKindSchema,
  untrustedPartSchema,
  type AssistantEffectKind,
} from '@uw/contracts';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantEffects, assistantRequests, assistantSettings } from '../schema.ts';
import { effectSettled } from './assistant-pool.ts';
import { effectSettledSql } from './assistant-spend-sql.ts';
import { recentRequests, redactEffects, redactRequests } from './assistant-history.ts';
import { addResearchSources, researchSources } from './assistant-research-sources.ts';
import { unstartedRequests } from './assistant-unstarted.ts';
import { deliveredReplyFor } from './events.ts';
import { refusing } from './refusal.ts';
import type {
  AssistantEffectPayload,
  AssistantEffectRow,
  AssistantEffectsGateway,
  AssistantRequestRow,
  AssistantRequestsGateway,
  AssistantSettingsGateway,
  AssistantSettingsRow,
  ThreadQuery,
} from './types.ts';

const THREAD_READ_MOST = 12;
const EFFECT_READ_MOST = 100;
const untrustedParts = untrustedPartSchema.array();

function toSettings(row: typeof assistantSettings.$inferSelect): AssistantSettingsRow {
  return { ...row };
}

function toRequest(row: typeof assistantRequests.$inferSelect): AssistantRequestRow {
  return {
    id: row.id,
    harnessId: row.harnessId,
    personId: row.personId,
    channel: assistantChannelSchema.parse(row.channel),
    externalId: row.externalId,
    threadKey: row.threadKey,
    replyAddress: row.replyAddress,
    note: row.note,
    untrustedParts: untrustedParts.parse(row.untrustedParts),
    receivedAt: row.receivedAt,
    recordedAt: row.recordedAt,
  };
}

function payloadOf(value: unknown): AssistantEffectPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('assistant_effects.payload is not an object');
  }
  return { ...value };
}

function toEffect(row: typeof assistantEffects.$inferSelect): AssistantEffectRow {
  return {
    id: row.id,
    harnessId: row.harnessId,
    requestId: row.requestId,
    kind: assistantEffectKindSchema.parse(row.kind),
    idempotencyKey: row.idempotencyKey,
    payload: payloadOf(row.payload),
    createdAt: row.createdAt,
    ...(row.proposalId === null ? {} : { proposalId: row.proposalId }),
  };
}

function threadLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > THREAD_READ_MOST) {
    throw new RangeError(`a thread read holds 1 to ${THREAD_READ_MOST} requests, not ${limit}`);
  }
  return limit;
}

async function upsertSettings(
  executor: AnyExecutor,
  row: AssistantSettingsRow,
  expectedVersion: number,
): Promise<boolean> {
  if (expectedVersion === 0) {
    const inserted = await executor
      .insert(assistantSettings)
      .values({ ...row })
      .onConflictDoNothing({ target: assistantSettings.harnessId })
      .returning({ harnessId: assistantSettings.harnessId });
    return inserted.length === 1;
  }
  const updated = await executor
    .update(assistantSettings)
    .set({ ...row })
    .where(
      and(
        eq(assistantSettings.harnessId, row.harnessId),
        eq(assistantSettings.version, expectedVersion),
      ),
    )
    .returning({ harnessId: assistantSettings.harnessId });
  return updated.length === 1;
}

export function bindAssistantSettings(executor: AnyExecutor): AssistantSettingsGateway {
  return {
    read: {
      byHarness: async (harnessId) => {
        const rows = await executor
          .select()
          .from(assistantSettings)
          .where(eq(assistantSettings.harnessId, harnessId));
        return rows[0] ? toSettings(rows[0]) : null;
      },
    },
    write: {
      upsert: (row, expectedVersion) =>
        refusing(() => upsertSettings(executor, row, expectedVersion)),
    },
  };
}

export function deliveredInThreadQuery(executor: AnyExecutor, query: ThreadQuery) {
  const { before } = query;
  return executor
    .select()
    .from(assistantRequests)
    .where(
      and(
        eq(assistantRequests.harnessId, query.harnessId),
        eq(assistantRequests.channel, query.channel),
        eq(assistantRequests.threadKey, query.threadKey),
        gte(assistantRequests.recordedAt, query.since),
        sql`(${assistantRequests.recordedAt}, ${assistantRequests.id}) < (${before.recordedAt.toISOString()}::timestamptz, ${before.id}::uuid)`,
        deliveredReplyFor(assistantRequests.id, assistantRequests.harnessId, {
          table: assistantEffects,
          id: assistantEffects.id,
          harnessId: assistantEffects.harnessId,
          requestId: assistantEffects.requestId,
          kind: assistantEffects.kind,
        }),
      ),
    )
    .orderBy(desc(assistantRequests.recordedAt), desc(assistantRequests.id))
    .limit(threadLimit(query.limit));
}

async function deliveredInThread(
  executor: AnyExecutor,
  query: ThreadQuery,
): Promise<readonly AssistantRequestRow[]> {
  const rows = await deliveredInThreadQuery(executor, query);
  return rows.map(toRequest).reverse();
}

export function bindAssistantRequests(executor: AnyExecutor): AssistantRequestsGateway {
  return {
    read: {
      byId: async (requestId) => {
        const rows = await executor
          .select()
          .from(assistantRequests)
          .where(eq(assistantRequests.id, requestId));
        return rows[0] ? toRequest(rows[0]) : null;
      },
      byExternal: async (channel, externalId) => {
        const rows = await executor
          .select()
          .from(assistantRequests)
          .where(
            and(
              eq(assistantRequests.channel, channel),
              eq(assistantRequests.externalId, externalId),
            ),
          );
        return rows[0] ? toRequest(rows[0]) : null;
      },
      deliveredInThread: (query) => deliveredInThread(executor, query),
      countSince: (harnessId, since) => requestsSince(executor, harnessId, since),
      unstarted: (query) => unstartedRequests(executor, query),
      recent: (harnessId, limit) => recentRequests(executor, harnessId, limit, toRequest),
      researchSources: (requestId) => researchSources(executor, requestId),
    },
    write: {
      insert: (row) =>
        refusing(async () => {
          await executor
            .insert(assistantRequests)
            .values({ ...row, untrustedParts: [...row.untrustedParts] });
        }),
      redact: (query) => refusing(() => redactRequests(executor, query)),
      addResearchSources: (requestId, urls) =>
        refusing(() => addResearchSources(executor, requestId, urls)),
    },
  };
}

async function requestsSince(
  executor: AnyExecutor,
  harnessId: string,
  since: Date,
): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(assistantRequests)
    .where(
      and(eq(assistantRequests.harnessId, harnessId), gte(assistantRequests.recordedAt, since)),
    );
  return rows[0]?.count ?? 0;
}

async function effectsSince(
  executor: AnyExecutor,
  harnessId: string,
  kind: AssistantEffectKind,
  since: Date,
): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(assistantEffects)
    .where(
      and(
        eq(assistantEffects.harnessId, harnessId),
        eq(assistantEffects.kind, kind),
        gte(assistantEffects.createdAt, since),
      ),
    );
  return rows[0]?.count ?? 0;
}

async function effectsFor(executor: AnyExecutor, requestIds: readonly string[]) {
  if (requestIds.length === 0) return [];
  const rows = await executor
    .select()
    .from(assistantEffects)
    .where(inArray(assistantEffects.requestId, [...requestIds]))
    .orderBy(asc(assistantEffects.createdAt), asc(assistantEffects.id))
    .limit(EFFECT_READ_MOST);
  return rows.map(toEffect);
}

const OPEN_READ_MOST = 200;

function openLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > OPEN_READ_MOST) {
    throw new RangeError(`an open effect read holds 1 to ${OPEN_READ_MOST} effects, not ${limit}`);
  }
  return limit;
}

function openProposalEffects(executor: AnyExecutor, startedBefore: Date, limit: number) {
  return executor
    .select()
    .from(assistantEffects)
    .where(
      and(
        isNotNull(assistantEffects.proposalId),
        lt(assistantEffects.createdAt, startedBefore),
        sql`NOT ${effectSettledSql(assistantEffects.id, assistantEffects.harnessId)}`,
      ),
    )
    .orderBy(asc(assistantEffects.createdAt), asc(assistantEffects.id))
    .limit(openLimit(limit));
}

function openEffectReads(executor: AnyExecutor) {
  return {
    openProposals: async (startedBefore: Date, limit: number) =>
      (await openProposalEffects(executor, startedBefore, limit)).map(toEffect),
    settled: (harnessId: string, effectId: string) => effectSettled(executor, harnessId, effectId),
  };
}

export function bindAssistantEffects(executor: AnyExecutor): AssistantEffectsGateway {
  return {
    read: {
      byId: async (effectId) => {
        const rows = await executor
          .select()
          .from(assistantEffects)
          .where(eq(assistantEffects.id, effectId));
        return rows[0] ? toEffect(rows[0]) : null;
      },
      byKey: async (harnessId, idempotencyKey) => {
        const rows = await executor
          .select()
          .from(assistantEffects)
          .where(
            and(
              eq(assistantEffects.harnessId, harnessId),
              eq(assistantEffects.idempotencyKey, idempotencyKey),
            ),
          );
        return rows[0] ? toEffect(rows[0]) : null;
      },
      forRequests: (requestIds) => effectsFor(executor, requestIds),
      countSince: (harnessId, kind, since) => effectsSince(executor, harnessId, kind, since),
      ...openEffectReads(executor),
    },
    write: {
      insert: (row) =>
        refusing(async () => {
          const inserted = await executor
            .insert(assistantEffects)
            .values({ ...row, payload: { ...row.payload } })
            .onConflictDoNothing({
              target: [assistantEffects.harnessId, assistantEffects.idempotencyKey],
            })
            .returning({ id: assistantEffects.id });
          return inserted.length === 1;
        }),
      redactFor: (requestIds, at) => refusing(() => redactEffects(executor, requestIds, at)),
    },
  };
}

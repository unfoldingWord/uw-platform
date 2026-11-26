import {
  assistantChannelSchema,
  assistantEffectKindSchema,
  untrustedPartSchema,
} from '@uw/contracts';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantEffects, assistantRequests, assistantSettings } from '../schema.ts';
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
    ...row,
    channel: assistantChannelSchema.parse(row.channel),
    untrustedParts: untrustedParts.parse(row.untrustedParts),
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
    ...row,
    kind: assistantEffectKindSchema.parse(row.kind),
    payload: payloadOf(row.payload),
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
    },
    write: {
      insert: (row) =>
        refusing(async () => {
          await executor
            .insert(assistantRequests)
            .values({ ...row, untrustedParts: [...row.untrustedParts] });
        }),
    },
  };
}

export function bindAssistantEffects(executor: AnyExecutor): AssistantEffectsGateway {
  return {
    read: {
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
      forRequests: async (requestIds) => {
        if (requestIds.length === 0) return [];
        const rows = await executor
          .select()
          .from(assistantEffects)
          .where(inArray(assistantEffects.requestId, [...requestIds]))
          .orderBy(asc(assistantEffects.createdAt), asc(assistantEffects.id))
          .limit(EFFECT_READ_MOST);
        return rows.map(toEffect);
      },
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
    },
  };
}

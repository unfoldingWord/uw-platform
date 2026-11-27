import { assistantChannelSchema, assistantPairingViaSchema } from '@uw/contracts';
import { and, eq } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantBindings, assistantPairingCodes } from '../schema.ts';
import { refusing } from './refusal.ts';
import type {
  AssistantBindingRow,
  AssistantBindingsGateway,
  AssistantPairingCodeRow,
  AssistantPairingCodesGateway,
} from './types.ts';

function toBinding(row: typeof assistantBindings.$inferSelect): AssistantBindingRow {
  return {
    ...row,
    channel: assistantChannelSchema.parse(row.channel),
    via: assistantPairingViaSchema.parse(row.via),
  };
}

function toCode(row: typeof assistantPairingCodes.$inferSelect): AssistantPairingCodeRow {
  return { ...row, channel: assistantChannelSchema.parse(row.channel) };
}

export function bindAssistantBindings(executor: AnyExecutor): AssistantBindingsGateway {
  return {
    read: {
      of: async (harnessId, channel) => {
        const rows = await executor
          .select()
          .from(assistantBindings)
          .where(
            and(eq(assistantBindings.harnessId, harnessId), eq(assistantBindings.channel, channel)),
          );
        return rows[0] ? toBinding(rows[0]) : null;
      },
      byAddress: async (channel, address) => {
        const rows = await executor
          .select()
          .from(assistantBindings)
          .where(
            and(eq(assistantBindings.channel, channel), eq(assistantBindings.address, address)),
          );
        return rows[0] ? toBinding(rows[0]) : null;
      },
    },
    write: {
      put: (row) =>
        refusing(async () => {
          await executor
            .insert(assistantBindings)
            .values({ ...row })
            .onConflictDoUpdate({
              target: [assistantBindings.harnessId, assistantBindings.channel],
              set: { address: row.address, via: row.via, boundAt: row.boundAt },
            });
        }),
    },
  };
}

function codeOf(harnessId: string, channel: string) {
  return and(
    eq(assistantPairingCodes.harnessId, harnessId),
    eq(assistantPairingCodes.channel, channel),
  );
}

export function bindAssistantPairingCodes(executor: AnyExecutor): AssistantPairingCodesGateway {
  return {
    read: {
      of: async (harnessId, channel) => {
        const rows = await executor
          .select()
          .from(assistantPairingCodes)
          .where(codeOf(harnessId, channel));
        return rows[0] ? toCode(rows[0]) : null;
      },
    },
    write: {
      put: (row) =>
        refusing(async () => {
          await executor
            .insert(assistantPairingCodes)
            .values({ ...row })
            .onConflictDoUpdate({
              target: [assistantPairingCodes.harnessId, assistantPairingCodes.channel],
              set: {
                codeDigest: row.codeDigest,
                expiresAt: row.expiresAt,
                attempts: row.attempts,
                createdAt: row.createdAt,
              },
            });
        }),
      attempted: (harnessId, channel, attempts) =>
        refusing(async () => {
          await executor
            .update(assistantPairingCodes)
            .set({ attempts })
            .where(codeOf(harnessId, channel));
        }),
      remove: (harnessId, channel) =>
        refusing(async () => {
          await executor.delete(assistantPairingCodes).where(codeOf(harnessId, channel));
        }),
    },
  };
}

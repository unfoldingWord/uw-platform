import { and, eq } from 'drizzle-orm';
import type { Database } from '@uw/db/client';
import { assistantZulipBots } from '@uw/db/schema';

type BotToken = { readonly botUserId: number; readonly digest: string };

export type BotTokens = { byBotEmail(botEmail: string): Promise<BotToken | null> };

export function postgresBotTokens(db: Database): BotTokens {
  return {
    byBotEmail: async (botEmail) => {
      const rows = await db
        .select({
          botUserId: assistantZulipBots.botUserId,
          digest: assistantZulipBots.webhookTokenDigest,
        })
        .from(assistantZulipBots)
        .where(
          and(eq(assistantZulipBots.botEmail, botEmail), eq(assistantZulipBots.status, 'active')),
        );
      return rows[0] ?? null;
    },
  };
}

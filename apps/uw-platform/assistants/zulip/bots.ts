import { and, eq } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { assistantBindings, assistantZulipBots } from '@uw/db/schema';
import type { CredentialCipher } from '@uw/core/credentials';
import type { SealedBotKey } from '../../credentials/assistant-bot-keys.ts';

export type BotStatus = 'active' | 'deactivated';

export type BotRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly botUserId: number;
  readonly botEmail: string;
  readonly fullName: string;
  readonly sealedKey: SealedBotKey;
  readonly webhookTokenDigest: string;
  readonly status: BotStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type DeliveryTarget = { readonly bot: BotRow; readonly address: string | null };

type Stored = typeof assistantZulipBots.$inferSelect;

const CIPHER: CredentialCipher = 'aes-256-gcm';

function rowOf(stored: Stored): BotRow | null {
  if (stored.keyCipher !== CIPHER) return null;
  if (stored.status !== 'active' && stored.status !== 'deactivated') return null;
  return {
    harnessId: stored.harnessId,
    personId: stored.personId,
    botUserId: stored.botUserId,
    botEmail: stored.botEmail,
    fullName: stored.fullName,
    sealedKey: {
      cipher: CIPHER,
      ciphertext: stored.keyCiphertext,
      nonce: stored.keyNonce,
      wrappedKey: stored.keyWrapped,
      keyId: stored.keyId,
    },
    webhookTokenDigest: stored.webhookTokenDigest,
    status: stored.status,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

export async function insertBot(db: Executor, row: BotRow): Promise<boolean> {
  const { sealedKey, ...rest } = row;
  const inserted = await db
    .insert(assistantZulipBots)
    .values({
      ...rest,
      keyCipher: sealedKey.cipher,
      keyCiphertext: sealedKey.ciphertext,
      keyNonce: sealedKey.nonce,
      keyWrapped: sealedKey.wrappedKey,
      keyId: sealedKey.keyId,
    })
    .onConflictDoNothing({ target: assistantZulipBots.harnessId })
    .returning({ harnessId: assistantZulipBots.harnessId });
  return inserted.length === 1;
}

export async function botOfHarness(db: Executor, harnessId: string): Promise<BotRow | null> {
  const rows = await db
    .select()
    .from(assistantZulipBots)
    .where(eq(assistantZulipBots.harnessId, harnessId));
  return rows[0] ? rowOf(rows[0]) : null;
}

export async function botByEmail(db: Executor, botEmail: string): Promise<BotRow | null> {
  const rows = await db
    .select()
    .from(assistantZulipBots)
    .where(eq(assistantZulipBots.botEmail, botEmail));
  return rows[0] ? rowOf(rows[0]) : null;
}

export async function setBotStatus(
  db: Executor,
  harnessId: string,
  status: BotStatus,
  at: Date,
): Promise<void> {
  await db
    .update(assistantZulipBots)
    .set({ status, updatedAt: at })
    .where(eq(assistantZulipBots.harnessId, harnessId));
}

export async function setBotFullName(
  db: Executor,
  harnessId: string,
  fullName: string,
  at: Date,
): Promise<void> {
  await db
    .update(assistantZulipBots)
    .set({ fullName, updatedAt: at })
    .where(eq(assistantZulipBots.harnessId, harnessId));
}

export async function deliveryTarget(
  db: Executor,
  personId: string,
): Promise<DeliveryTarget | null> {
  const rows = await db
    .select({ bot: assistantZulipBots, address: assistantBindings.address })
    .from(assistantZulipBots)
    .leftJoin(
      assistantBindings,
      and(
        eq(assistantBindings.harnessId, assistantZulipBots.harnessId),
        eq(assistantBindings.personId, assistantZulipBots.personId),
        eq(assistantBindings.channel, 'zulip_dm'),
      ),
    )
    .where(eq(assistantZulipBots.personId, personId));
  const first = rows[0];
  const bot = first ? rowOf(first.bot) : null;
  return first && bot ? { bot, address: first.address } : null;
}

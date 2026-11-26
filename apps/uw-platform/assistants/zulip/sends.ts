import { and, eq } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { assistantZulipSends } from '@uw/db/schema';

export type SendClaim = 'claimed' | 'sent' | 'unsettled';

export type SendKey = { readonly effectId: string; readonly harnessId: string };

export async function claimSend(db: Executor, key: SendKey, at: Date): Promise<SendClaim> {
  const claimed = await db
    .insert(assistantZulipSends)
    .values({ ...key, status: 'sending', zulipMessageId: null, claimedAt: at, sentAt: null })
    .onConflictDoNothing({ target: assistantZulipSends.effectId })
    .returning({ effectId: assistantZulipSends.effectId });
  if (claimed.length === 1) return 'claimed';
  const rows = await db
    .select({ status: assistantZulipSends.status })
    .from(assistantZulipSends)
    .where(eq(assistantZulipSends.effectId, key.effectId));
  return rows[0]?.status === 'sent' ? 'sent' : 'unsettled';
}

export async function markSent(
  db: Executor,
  effectId: string,
  zulipMessageId: number,
  at: Date,
): Promise<void> {
  await db
    .update(assistantZulipSends)
    .set({ status: 'sent', zulipMessageId, sentAt: at })
    .where(
      and(eq(assistantZulipSends.effectId, effectId), eq(assistantZulipSends.status, 'sending')),
    );
}

export async function releaseSend(db: Executor, effectId: string): Promise<void> {
  await db
    .delete(assistantZulipSends)
    .where(
      and(eq(assistantZulipSends.effectId, effectId), eq(assistantZulipSends.status, 'sending')),
    );
}

export async function sentMessages(
  db: Executor,
  harnessId: string,
): Promise<readonly { readonly effectId: string; readonly zulipMessageId: number }[]> {
  const rows = await db
    .select({
      effectId: assistantZulipSends.effectId,
      zulipMessageId: assistantZulipSends.zulipMessageId,
    })
    .from(assistantZulipSends)
    .where(
      and(eq(assistantZulipSends.harnessId, harnessId), eq(assistantZulipSends.status, 'sent')),
    );
  return rows.flatMap((row) =>
    row.zulipMessageId === null
      ? []
      : [{ effectId: row.effectId, zulipMessageId: row.zulipMessageId }],
  );
}

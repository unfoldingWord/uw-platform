import { and, eq } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { assistantMailSends } from '@uw/db/schema';

export type SendClaim = 'claimed' | 'sent' | 'unsettled';

export type SendKey = { readonly effectId: string; readonly harnessId: string };

export async function claimSend(db: Executor, key: SendKey, at: Date): Promise<SendClaim> {
  const claimed = await db
    .insert(assistantMailSends)
    .values({ ...key, status: 'sending', gmailMessageId: null, claimedAt: at, sentAt: null })
    .onConflictDoNothing({ target: assistantMailSends.effectId })
    .returning({ effectId: assistantMailSends.effectId });
  if (claimed.length === 1) return 'claimed';
  const rows = await db
    .select({ status: assistantMailSends.status })
    .from(assistantMailSends)
    .where(eq(assistantMailSends.effectId, key.effectId));
  return rows[0]?.status === 'sent' ? 'sent' : 'unsettled';
}

export async function markSent(
  db: Executor,
  effectId: string,
  gmailMessageId: string,
  at: Date,
): Promise<void> {
  await db
    .update(assistantMailSends)
    .set({ status: 'sent', gmailMessageId, sentAt: at })
    .where(
      and(eq(assistantMailSends.effectId, effectId), eq(assistantMailSends.status, 'sending')),
    );
}

export async function releaseSend(db: Executor, effectId: string): Promise<void> {
  await db
    .delete(assistantMailSends)
    .where(
      and(eq(assistantMailSends.effectId, effectId), eq(assistantMailSends.status, 'sending')),
    );
}

export async function sentMessages(
  db: Executor,
  harnessId: string,
): Promise<readonly { readonly effectId: string; readonly gmailMessageId: string }[]> {
  const rows = await db
    .select({
      effectId: assistantMailSends.effectId,
      gmailMessageId: assistantMailSends.gmailMessageId,
    })
    .from(assistantMailSends)
    .where(and(eq(assistantMailSends.harnessId, harnessId), eq(assistantMailSends.status, 'sent')));
  return rows.flatMap((row) =>
    row.gmailMessageId === null
      ? []
      : [{ effectId: row.effectId, gmailMessageId: row.gmailMessageId }],
  );
}

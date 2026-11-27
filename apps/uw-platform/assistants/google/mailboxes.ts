import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { assistantBindings, assistantMailboxes } from '@uw/db/schema';

export type SweptMailbox = {
  readonly harnessId: string;
  readonly personId: string;
  readonly address: string;
  readonly historyId: string | null;
  readonly labelId: string | null;
};
export type MailboxCursor = {
  readonly historyId: string | null;
  readonly labelId: string | null;
  readonly sweptAt: Date;
};

export async function mailboxesToSweep(
  db: Executor,
  limit: number,
): Promise<readonly SweptMailbox[]> {
  return db
    .select({
      harnessId: assistantMailboxes.harnessId,
      personId: assistantMailboxes.personId,
      address: assistantMailboxes.address,
      historyId: assistantMailboxes.historyId,
      labelId: assistantMailboxes.processedLabelId,
    })
    .from(assistantMailboxes)
    .where(eq(assistantMailboxes.status, 'active'))
    .orderBy(sql`${assistantMailboxes.sweptAt} ASC NULLS FIRST`, asc(assistantMailboxes.harnessId))
    .limit(limit);
}

export async function saveCursor(
  db: Executor,
  harnessId: string,
  cursor: MailboxCursor,
): Promise<void> {
  await db
    .update(assistantMailboxes)
    .set({
      historyId: cursor.historyId,
      processedLabelId: cursor.labelId,
      sweptAt: cursor.sweptAt,
    })
    .where(eq(assistantMailboxes.harnessId, harnessId));
}

export async function isAssistantMailbox(db: Executor, address: string): Promise<boolean> {
  const rows = await db
    .select({ address: assistantMailboxes.address })
    .from(assistantMailboxes)
    .where(eq(assistantMailboxes.address, address.trim().toLowerCase()));
  return rows.length > 0;
}

export type MailTarget = {
  readonly harnessId: string;
  readonly mailbox: string;
  readonly address: string;
};

export async function mailTarget(db: Executor, personId: string): Promise<MailTarget | null> {
  const rows = await db
    .select({
      harnessId: assistantMailboxes.harnessId,
      mailbox: assistantMailboxes.address,
      address: assistantBindings.address,
    })
    .from(assistantMailboxes)
    .innerJoin(
      assistantBindings,
      and(
        eq(assistantBindings.harnessId, assistantMailboxes.harnessId),
        eq(assistantBindings.personId, assistantMailboxes.personId),
        eq(assistantBindings.channel, 'email'),
      ),
    )
    .where(and(eq(assistantMailboxes.personId, personId), eq(assistantMailboxes.status, 'active')));
  return rows[0] ?? null;
}

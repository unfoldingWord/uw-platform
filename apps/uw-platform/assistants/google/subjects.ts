import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { assistantMailboxes, people } from '@uw/db/schema';
import type { SubjectKind } from './token.ts';

type MailboxStatus = 'active' | 'suspended' | 'deleted';
export type MailboxRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly address: string;
  readonly googleUserId: string | null;
  readonly status: MailboxStatus;
  readonly at: Date;
};

function inDomain(email: string, domain: string): boolean {
  return email.endsWith(`@${domain}`);
}

export async function personMailOf(
  db: Executor,
  personId: string,
  domain: string,
): Promise<string | null> {
  const rows = await db
    .select({ email: people.email })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.status, 'active')));
  const email = rows[0]?.email;
  return email !== undefined && inDomain(email, domain) ? email : null;
}

export async function orgAddresses(
  db: Executor,
  emails: readonly string[],
  domain: string,
): Promise<ReadonlySet<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .select({ email: people.email })
    .from(people)
    .where(and(inArray(people.email, [...emails]), eq(people.status, 'active')));
  return new Set(rows.map((row) => row.email).filter((email) => inDomain(email, domain)));
}

async function activeMailbox(db: Executor, email: string): Promise<boolean> {
  const rows = await db
    .select({ address: assistantMailboxes.address })
    .from(assistantMailboxes)
    .where(and(eq(assistantMailboxes.address, email), eq(assistantMailboxes.status, 'active')));
  return rows.length === 1;
}

export async function subjectKindOf(
  db: Executor,
  email: string,
  domain: string,
): Promise<SubjectKind | null> {
  if (!inDomain(email, domain)) return null;
  if (await activeMailbox(db, email)) return 'assistant_mailbox';
  return (await orgAddresses(db, [email], domain)).has(email) ? 'person' : null;
}

export async function putMailbox(db: Executor, row: MailboxRow): Promise<void> {
  const { at, ...values } = row;
  await db
    .insert(assistantMailboxes)
    .values({ ...values, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: assistantMailboxes.harnessId,
      set: {
        address: row.address,
        googleUserId: row.googleUserId,
        status: row.status,
        updatedAt: at,
      },
    });
}

export async function mailboxOf(db: Executor, harnessId: string): Promise<MailboxRow | null> {
  const rows = await db
    .select()
    .from(assistantMailboxes)
    .where(eq(assistantMailboxes.harnessId, harnessId));
  const row = rows[0];
  if (row === undefined) return null;
  const status = row.status === 'active' || row.status === 'suspended' ? row.status : 'deleted';
  const { harnessId: harness, personId, address, googleUserId } = row;
  return { harnessId: harness, personId, address, googleUserId, status, at: row.updatedAt };
}

export async function removeMailbox(db: Executor, harnessId: string): Promise<void> {
  await db.delete(assistantMailboxes).where(eq(assistantMailboxes.harnessId, harnessId));
}

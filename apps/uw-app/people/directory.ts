import { and, eq } from 'drizzle-orm';
import { personStatusSchema, type PersonStatus } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { people } from '@uw/db/schema';

export const owns = ['people'] as const;

const ORG_EMAIL_SUFFIX = '@unfoldingword.org';

export type PersonRecord = {
  readonly personId: string;
  readonly email: string;
  readonly status: PersonStatus;
};

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function statusForEmail(email: string): PersonStatus {
  return email.endsWith(ORG_EMAIL_SUFFIX) ? 'active' : 'pending';
}

async function selectByEmail(db: Executor, email: string): Promise<PersonRecord | null> {
  const [row] = await db.select().from(people).where(eq(people.email, email)).limit(1);
  if (!row) return null;
  return { personId: row.id, email: row.email, status: personStatusSchema.parse(row.status) };
}

export async function signIn(db: Executor, rawEmail: string): Promise<PersonRecord> {
  const email = normaliseEmail(rawEmail);
  const existing = await selectByEmail(db, email);
  if (existing) return existing;
  await db
    .insert(people)
    .values({
      email,
      displayName: email.slice(0, email.lastIndexOf('@')),
      status: statusForEmail(email),
    })
    .onConflictDoNothing();
  const created = await selectByEmail(db, email);
  if (!created) throw new Error('a person row must exist after sign-in');
  return created;
}

export async function personById(db: Executor, personId: string): Promise<PersonRecord | null> {
  const [row] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
  if (!row) return null;
  return { personId: row.id, email: row.email, status: personStatusSchema.parse(row.status) };
}

export async function personByEmail(db: Executor, email: string): Promise<PersonRecord | null> {
  const found = await selectByEmail(db, normaliseEmail(email));
  return found?.status === 'active' ? found : null;
}

export async function lockPerson(db: Executor, personId: string): Promise<PersonRecord | null> {
  const [row] = await db.select().from(people).where(eq(people.id, personId)).for('update');
  if (!row) return null;
  return { personId: row.id, email: row.email, status: personStatusSchema.parse(row.status) };
}

export async function activatePerson(db: Executor, personId: string): Promise<void> {
  await db
    .update(people)
    .set({ status: 'active' })
    .where(and(eq(people.id, personId), eq(people.status, 'pending')));
}

import { asc, eq } from 'drizzle-orm';
import { personStatusSchema, type PersonStatus } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { people, personAudit } from '@uw/db/schema';

export const owns = ['people', 'person_audit', 'directory_entries', 'directory_private'] as const;

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

export async function activePeople(db: Executor): Promise<readonly PersonRecord[]> {
  const rows = await db
    .select()
    .from(people)
    .where(eq(people.status, 'active'))
    .orderBy(asc(people.email));
  return rows.map((row) => ({ personId: row.id, email: row.email, status: 'active' }));
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

export type StatusChange = {
  readonly actor: Principal;
  readonly action: 'approve' | 'decline';
  readonly traceId: string;
  readonly at: Date;
};

function statusAfter(action: StatusChange['action']): PersonStatus {
  return action === 'approve' ? 'active' : 'disabled';
}

export async function changeStatus(
  tx: Executor,
  person: PersonRecord,
  change: StatusChange,
): Promise<void> {
  const after = statusAfter(change.action);
  await tx.update(people).set({ status: after }).where(eq(people.id, person.personId));
  await tx.insert(personAudit).values({
    actor: change.actor.identity,
    at: change.at,
    action: change.action,
    personId: person.personId,
    before: person.status,
    after,
    traceId: change.traceId,
  });
}

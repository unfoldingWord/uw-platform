import { eq, inArray } from 'drizzle-orm';
import type { ErrorReason, RecordStoryConsentCommand } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Executor } from '@uw/db/client';
import { storyConsents } from '@uw/db/schema';
import type { ConsentFacts } from './expression-flags.ts';

export type ConsentRow = typeof storyConsents.$inferSelect;

export type ConsentState = 'recorded' | 'expired' | 'withdrawn';

export function consentStateOf(row: ConsentRow, at: Date): ConsentState {
  if (row.withdrawnAt !== null) return 'withdrawn';
  const expires = row.consentExpires;
  return expires !== null && expires < formatDate(at) ? 'expired' : 'recorded';
}

export function consentFactsOf(row: ConsentRow | null): ConsentFacts {
  if (row === null) return null;
  const withdrawnOn = row.withdrawnAt === null ? null : formatDate(row.withdrawnAt);
  return { consentedOn: row.consentedOn, expires: row.consentExpires, withdrawnOn };
}

const refusalByState: Readonly<Record<ConsentState, ErrorReason | null>> = {
  recorded: null,
  expired: 'consent_expired',
  withdrawn: 'consent_withdrawn',
};

export async function consentRowOf(db: Executor, pageId: string): Promise<ConsentRow | null> {
  const [row] = await db.select().from(storyConsents).where(eq(storyConsents.pageId, pageId));
  return row ?? null;
}

export async function consentRowsOf(
  db: Executor,
  pageIds: readonly string[],
): Promise<ReadonlyMap<string, ConsentRow>> {
  const ids = [...new Set(pageIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(storyConsents).where(inArray(storyConsents.pageId, ids));
  return new Map(rows.map((row) => [row.pageId, row]));
}

export async function consentRefusal(
  db: Executor,
  pageId: string,
  at: Date,
  photo: boolean,
): Promise<ErrorReason | null> {
  const row = await consentRowOf(db, pageId);
  if (row === null) return 'consent_required';
  const refused = refusalByState[consentStateOf(row, at)];
  if (refused !== null) return refused;
  return photo && !row.photoRelease ? 'photo_release_required' : null;
}

export async function keepConsent(
  db: Executor,
  command: RecordStoryConsentCommand,
  by: string,
  at: Date,
): Promise<void> {
  const record = {
    consentReference: command.consentReference,
    consentedBy: command.consentedBy,
    consentForm: command.consentForm,
    consentedOn: command.consentedOn,
    consentExpires: command.consentExpires,
    anonymised: command.anonymised,
    nameUse: command.nameUse,
    locationPrecision: command.locationPrecision,
    photoRelease: command.photoRelease,
    photoReference: command.photoRelease ? command.photoReference : null,
    reviewOn: command.reviewOn,
    withdrawnAt: null,
    updatedBy: by,
    updatedAt: at,
  };
  await db
    .insert(storyConsents)
    .values({ pageId: command.pageId, ...record })
    .onConflictDoUpdate({ target: storyConsents.pageId, set: record });
}

export async function markWithdrawn(
  db: Executor,
  pageId: string,
  by: string,
  at: Date,
): Promise<void> {
  await db
    .update(storyConsents)
    .set({ withdrawnAt: at, updatedBy: by, updatedAt: at })
    .where(eq(storyConsents.pageId, pageId));
}

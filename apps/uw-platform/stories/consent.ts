import { asc, eq, inArray } from 'drizzle-orm';
import {
  consentHistoryKinds,
  type ErrorReason,
  type RecordStoryConsentCommand,
} from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Executor } from '@uw/db/client';
import { storyConsentHistory, storyConsents } from '@uw/db/schema';
import { z } from 'zod';
import {
  standingOn,
  type ConsentEntry,
  type ConsentHistory,
  type IntervalStanding,
} from './consent-interval.ts';

export type ConsentRow = typeof storyConsents.$inferSelect;

export type ConsentState = 'recorded' | 'not_started' | 'expired' | 'withdrawn';

const stateByStanding: Readonly<Record<IntervalStanding, ConsentState>> = {
  in_effect: 'recorded',
  not_started: 'not_started',
  ended: 'expired',
  withdrawn: 'withdrawn',
};

export function consentStateOf(row: ConsentRow, at: Date): ConsentState {
  const withdrawnOn = row.withdrawnAt === null ? null : formatDate(row.withdrawnAt);
  const interval = { startsOn: row.consentedOn, endsBefore: row.consentExpires, withdrawnOn };
  return stateByStanding[standingOn(interval, formatDate(at))];
}

const refusalByState: Readonly<Record<ConsentState, ErrorReason | null>> = {
  recorded: null,
  not_started: 'consent_not_started',
  expired: 'consent_expired',
  withdrawn: 'consent_withdrawn',
};

const historyKindSchema = z.enum(consentHistoryKinds);

function entryOf(row: typeof storyConsentHistory.$inferSelect): ConsentEntry {
  const kind = historyKindSchema.parse(row.kind);
  if (kind === 'withdrawn') return { kind, startsOn: row.startsOn };
  return { kind, startsOn: row.startsOn, endsBefore: row.endsBefore };
}

export async function consentHistoriesOf(
  db: Executor,
  pageIds: readonly string[],
): Promise<ReadonlyMap<string, ConsentHistory>> {
  const ids = [...new Set(pageIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(storyConsentHistory)
    .where(inArray(storyConsentHistory.pageId, ids))
    .orderBy(asc(storyConsentHistory.recordedAt), asc(storyConsentHistory.id));
  const histories = new Map<string, ConsentEntry[]>(ids.map((id) => [id, []]));
  for (const row of rows) histories.get(row.pageId)?.push(entryOf(row));
  return histories;
}

export async function consentHistoryOf(db: Executor, pageId: string): Promise<ConsentHistory> {
  return (await consentHistoriesOf(db, [pageId])).get(pageId) ?? [];
}

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
  await db.insert(storyConsentHistory).values({
    pageId: command.pageId,
    kind: 'granted',
    startsOn: command.consentedOn,
    endsBefore: command.consentExpires,
    recordedBy: by,
    recordedAt: at,
  });
}

export async function markWithdrawn(
  db: Executor,
  pageId: string,
  by: string,
  at: Date,
): Promise<void> {
  const withdrawn = await db
    .update(storyConsents)
    .set({ withdrawnAt: at, updatedBy: by, updatedAt: at })
    .where(eq(storyConsents.pageId, pageId))
    .returning({ pageId: storyConsents.pageId });
  if (withdrawn.length === 0) return;
  await db.insert(storyConsentHistory).values({
    pageId,
    kind: 'withdrawn',
    startsOn: formatDate(at),
    endsBefore: null,
    recordedBy: by,
    recordedAt: at,
  });
}

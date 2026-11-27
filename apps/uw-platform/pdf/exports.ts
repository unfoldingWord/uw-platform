import { and, count, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import {
  pdfExportKindSchema,
  pdfExportStatusSchema,
  renderChannelSchema,
  type ErrorReason,
  type PdfExportKind,
  type PdfExportReply,
  type PdfExportStatus,
  type RenderChannel,
  type StoryUseKind,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor } from '@uw/db/client';
import { pdfExports } from '@uw/db/schema';
import type { FileStore } from '../pages/file-store.ts';
import { clearanceRefusal } from '../stories/clearance.ts';
import { recordStoryUses, type StoryVersion } from '../stories/uses.ts';
import { sha256Hex } from './provenance.ts';

export const exportLifetimeDays = 7;
export const dailyRenderLimit = 200;
const queuedLongestHours = 1;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const PDF = 'application/pdf';
const LIVE: readonly PdfExportStatus[] = ['queued', 'ready', 'failed'];

export type Requester = Pick<Principal, 'identity' | 'personId'>;

export type ExportInput = {
  readonly kind: PdfExportKind;
  readonly title: string;
  readonly reference: string;
  readonly areas: readonly string[];
  readonly request: unknown;
  readonly actor: Requester;
  readonly at: Date;
};

type ExportHashes = { readonly sourceSha256: string; readonly fileSha256: string };

export type ExportDrawn = {
  readonly channel: RenderChannel;
  readonly stories: readonly StoryVersion[];
};

const drawnStoriesSchema = z.array(
  z.object({ pageId: z.uuid(), version: z.number().int().min(1) }),
);

export type RenderOutcome =
  | ({ readonly kind: 'printed'; readonly bytes: number } & ExportHashes)
  | { readonly kind: 'failed'; readonly reason: ErrorReason };

export type ReadyOutcome = {
  readonly kind: 'ready';
  readonly r2Key: string;
  readonly bytes: number;
  readonly areas: readonly string[];
} & ExportHashes &
  ExportDrawn;

export type ExportOutcome =
  ReadyOutcome | { readonly kind: 'failed'; readonly reason: ErrorReason };

export type ExportRecord = PdfExportReply & {
  readonly kind: PdfExportKind;
  readonly title: string;
  readonly reference: string;
  readonly areas: readonly string[];
  readonly failure: string | null;
  readonly r2Key: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly withheld: ErrorReason | null;
} & ExportDrawn;

export type QueuedExport = {
  readonly title: string;
  readonly request: unknown;
  readonly requestedBy: string;
  readonly personId: string | null;
  readonly areas: readonly string[];
};

type Row = typeof pdfExports.$inferSelect;

export function exportPath(exportId: string): string {
  return `/exports/${exportId}`;
}

export function exportFilePath(exportId: string): string {
  return `/api/exports/${exportId}/file`;
}

export function exportKey(exportId: string): string {
  return `exports/${exportId}.pdf`;
}

function rowOf(input: ExportInput, exportId: string) {
  return {
    id: exportId,
    kind: input.kind,
    status: 'queued' as const,
    title: input.title,
    reference: input.reference,
    requestedBy: input.actor.identity,
    personId: input.actor.personId,
    areas: [...input.areas],
    request: { target: input.request },
    createdAt: input.at,
    expiresAt: new Date(input.at.getTime() + exportLifetimeDays * DAY_MS),
  };
}

export async function queueExport(
  db: Executor,
  input: ExportInput,
): Promise<{ readonly exportId: string }> {
  const exportId = crypto.randomUUID();
  await db.insert(pdfExports).values(rowOf(input, exportId));
  return { exportId };
}

function finished(outcome: ExportOutcome, at: Date) {
  if (outcome.kind === 'failed') {
    return { status: 'failed' as const, failure: outcome.reason, finishedAt: at };
  }
  const { r2Key, sourceSha256, fileSha256, bytes, channel } = outcome;
  const areas = [...outcome.areas];
  const stories = [...outcome.stories];
  return {
    status: 'ready' as const,
    ...{ r2Key, sourceSha256, fileSha256, bytes, areas, channel, stories },
    finishedAt: at,
  };
}

export async function finishExport(
  db: Executor,
  exportId: string,
  outcome: ExportOutcome,
  at: Date,
): Promise<boolean> {
  const finishedRows = await db
    .update(pdfExports)
    .set(finished(outcome, at))
    .where(and(eq(pdfExports.id, exportId), eq(pdfExports.status, 'queued')))
    .returning({ id: pdfExports.id });
  return finishedRows.length > 0;
}

type Use = { readonly kind: StoryUseKind; readonly usedBy: string; readonly at: Date };

function usesOf(exportId: string, drawn: ExportDrawn, use: Use) {
  return { ...use, stories: drawn.stories, channel: drawn.channel, reference: exportId };
}

export function finishReadyExport(
  db: Database,
  exportId: string,
  outcome: ReadyOutcome,
  usedBy: string,
  at: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await finishExport(tx, exportId, outcome, at))) return false;
    await recordStoryUses(tx, usesOf(exportId, outcome, { kind: 'pdf_binder', usedBy, at }));
    return true;
  });
}

export async function startQueuedExport(
  db: Executor,
  exportId: string,
  at: Date,
  start: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await start();
    return true;
  } catch {
    await finishExport(db, exportId, { kind: 'failed', reason: 'internal_error' }, at);
    return false;
  }
}

export async function queuedExport(db: Executor, exportId: string): Promise<QueuedExport | null> {
  const [row] = await db
    .select({
      title: pdfExports.title,
      request: pdfExports.request,
      requestedBy: pdfExports.requestedBy,
      personId: pdfExports.personId,
      areas: pdfExports.areas,
    })
    .from(pdfExports)
    .where(and(eq(pdfExports.id, exportId), eq(pdfExports.status, 'queued')));
  return row ?? null;
}

function statusAt(row: Row, at: Date): PdfExportStatus {
  const status = pdfExportStatusSchema.parse(row.status);
  return LIVE.includes(status) && row.expiresAt <= at ? 'expired' : status;
}

function recordOf(row: Row, at: Date): ExportRecord {
  const status = statusAt(row, at);
  const ready = status === 'ready';
  return {
    channel: renderChannelSchema.parse(row.channel),
    stories: drawnStoriesSchema.parse(row.stories),
    withheld: null,
    exportId: row.id,
    status,
    file: exportFilePath(row.id),
    sourceSha256: ready ? row.sourceSha256 : null,
    fileSha256: ready ? row.fileSha256 : null,
    bytes: ready ? row.bytes : null,
    kind: pdfExportKindSchema.parse(row.kind),
    title: row.title,
    reference: row.reference,
    areas: row.areas,
    failure: row.failure,
    r2Key: ready ? row.r2Key : null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function readsEvery(actor: Principal, areas: readonly string[], at: Date): boolean {
  return areas.length > 0 && areas.every((area) => can(actor, 'read', { kind: 'area', area }, at));
}

function madeFor(actor: Principal, row: Row): boolean {
  return row.personId !== null && actor.personId === row.personId;
}

export async function readExport(
  db: Executor,
  actor: Principal,
  exportId: string,
  at: Date,
): Promise<ExportRecord | null> {
  const [row] = await db.select().from(pdfExports).where(eq(pdfExports.id, exportId));
  if (row === undefined || !madeFor(actor, row) || !readsEvery(actor, row.areas, at)) return null;
  const record = recordOf(row, at);
  if (record.status !== 'ready') return record;
  const pageIds = record.stories.map((story) => story.pageId);
  return { ...record, withheld: await clearanceRefusal(db, pageIds, record.channel, at) };
}

type Stored = ExportInput &
  ExportDrawn & { readonly pdf: Uint8Array; readonly sourceSha256: string };

export async function storeReadyExport(
  db: Database,
  files: FileStore,
  input: Stored,
): Promise<PdfExportReply> {
  const exportId = crypto.randomUUID();
  const r2Key = exportKey(exportId);
  await files.put(r2Key, { bytes: input.pdf, contentType: PDF });
  const bytes = input.pdf.byteLength;
  const hashes = { sourceSha256: input.sourceSha256, fileSha256: await sha256Hex(input.pdf) };
  const { channel, stories, at } = input;
  const use = { kind: 'pdf_page', usedBy: input.actor.identity, at } as const;
  await db.transaction(async (tx) => {
    await tx.insert(pdfExports).values({
      ...rowOf(input, exportId),
      ...{ status: 'ready', r2Key, ...hashes, bytes, finishedAt: at },
      ...{ channel, stories: [...stories] },
    });
    await recordStoryUses(tx, usesOf(exportId, input, use));
  });
  return { exportId, status: 'ready', file: exportFilePath(exportId), ...hashes, bytes };
}

function rendersOf(actor: Requester) {
  if (actor.personId !== null) return eq(pdfExports.personId, actor.personId);
  return and(isNull(pdfExports.personId), eq(pdfExports.requestedBy, actor.identity));
}

export async function withinRenderLimit(
  db: Executor,
  actor: Requester,
  at: Date,
  limit: number = dailyRenderLimit,
): Promise<boolean> {
  const since = new Date(at.getTime() - DAY_MS);
  const [row] = await db
    .select({ renders: count() })
    .from(pdfExports)
    .where(and(rendersOf(actor), gt(pdfExports.createdAt, since)));
  return (row?.renders ?? 0) < limit;
}

function unstored(outcome: RenderOutcome, at: Date) {
  if (outcome.kind === 'failed') {
    return { status: 'failed' as const, failure: outcome.reason, finishedAt: at };
  }
  const { sourceSha256, fileSha256, bytes } = outcome;
  return { status: 'ready' as const, r2Key: null, sourceSha256, fileSha256, bytes, finishedAt: at };
}

export async function recordRender(
  db: Database,
  input: ExportInput & ExportDrawn,
  outcome: RenderOutcome,
): Promise<string> {
  const exportId = crypto.randomUUID();
  const printed = outcome.kind === 'printed';
  const drawn = { channel: input.channel, stories: printed ? [...input.stories] : [] };
  const use = { kind: 'pdf_page', usedBy: input.actor.identity, at: input.at } as const;
  await db.transaction(async (tx) => {
    const row = { ...rowOf(input, exportId), ...unstored(outcome, input.at), ...drawn };
    await tx.insert(pdfExports).values(row);
    await recordStoryUses(tx, usesOf(exportId, drawn, use));
  });
  return exportId;
}

export async function failStuckExports(db: Executor, at: Date): Promise<number> {
  const before = new Date(at.getTime() - queuedLongestHours * HOUR_MS);
  const stuck = await db
    .update(pdfExports)
    .set({ status: 'failed', failure: 'internal_error', finishedAt: at })
    .where(and(eq(pdfExports.status, 'queued'), lte(pdfExports.createdAt, before)))
    .returning({ id: pdfExports.id });
  return stuck.length;
}

export async function expireExports(db: Executor, files: FileStore, at: Date): Promise<number> {
  const lapsed = await db
    .select({ id: pdfExports.id, r2Key: pdfExports.r2Key })
    .from(pdfExports)
    .where(and(inArray(pdfExports.status, [...LIVE]), lte(pdfExports.expiresAt, at)));
  for (const row of lapsed) {
    if (row.r2Key !== null) await files.remove(row.r2Key);
    await db
      .update(pdfExports)
      .set({ status: 'expired', r2Key: null })
      .where(eq(pdfExports.id, row.id));
  }
  return lapsed.length;
}

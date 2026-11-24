import { and, eq, inArray, lte } from 'drizzle-orm';
import {
  pdfExportKindSchema,
  pdfExportStatusSchema,
  type ErrorReason,
  type PdfExportKind,
  type PdfExportReply,
  type PdfExportStatus,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pdfExports } from '@uw/db/schema';
import type { FileStore } from '../pages/file-store.ts';

export const exportLifetimeDays = 7;

const DAY_MS = 86_400_000;
const PDF = 'application/pdf';
const LIVE: readonly PdfExportStatus[] = ['queued', 'ready', 'failed'];

export type ExportInput = {
  readonly kind: PdfExportKind;
  readonly title: string;
  readonly reference: string;
  readonly areas: readonly string[];
  readonly request: unknown;
  readonly actor: Principal;
  readonly at: Date;
};

export type ExportOutcome =
  | {
      readonly kind: 'ready';
      readonly r2Key: string;
      readonly sha256: string;
      readonly bytes: number;
    }
  | { readonly kind: 'failed'; readonly reason: ErrorReason };

export type ExportRecord = PdfExportReply & {
  readonly kind: PdfExportKind;
  readonly title: string;
  readonly reference: string;
  readonly areas: readonly string[];
  readonly failure: string | null;
  readonly r2Key: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};

export type QueuedExport = { readonly title: string; readonly request: unknown };

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
    request: { target: input.request, principal: input.actor },
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
  const { r2Key, sha256, bytes } = outcome;
  return { status: 'ready' as const, r2Key, sha256, bytes, finishedAt: at };
}

export async function finishExport(
  db: Executor,
  exportId: string,
  outcome: ExportOutcome,
  at: Date,
): Promise<void> {
  await db
    .update(pdfExports)
    .set(finished(outcome, at))
    .where(and(eq(pdfExports.id, exportId), eq(pdfExports.status, 'queued')));
}

export async function queuedExport(db: Executor, exportId: string): Promise<QueuedExport | null> {
  const [row] = await db
    .select({ title: pdfExports.title, request: pdfExports.request })
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
    exportId: row.id,
    status,
    file: exportFilePath(row.id),
    sha256: ready ? row.sha256 : null,
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

export async function readExport(
  db: Executor,
  actor: Principal,
  exportId: string,
  at: Date,
): Promise<ExportRecord | null> {
  const [row] = await db.select().from(pdfExports).where(eq(pdfExports.id, exportId));
  if (row === undefined || !readsEvery(actor, row.areas, at)) return null;
  return recordOf(row, at);
}

export async function storeReadyExport(
  db: Executor,
  files: FileStore,
  input: ExportInput & { readonly pdf: Uint8Array; readonly sha256: string },
): Promise<PdfExportReply> {
  const exportId = crypto.randomUUID();
  const r2Key = exportKey(exportId);
  await files.put(r2Key, { bytes: input.pdf, contentType: PDF });
  const bytes = input.pdf.byteLength;
  await db.insert(pdfExports).values({
    ...rowOf(input, exportId),
    status: 'ready',
    r2Key,
    sha256: input.sha256,
    bytes,
    finishedAt: input.at,
  });
  return { exportId, status: 'ready', file: exportFilePath(exportId), sha256: input.sha256, bytes };
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

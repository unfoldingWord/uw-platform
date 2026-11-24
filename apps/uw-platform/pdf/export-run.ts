import { z } from 'zod';
import { binderRequestSchema, principalSchema, type ErrorReason } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { PdfExportStart } from '../env.ts';
import type { FileStore } from '../pages/file-store.ts';
import { exportKey, exportPath, finishExport, queuedExport } from './exports.ts';
import { printJob, type Printed } from './print-document.ts';
import { fileImages } from './print-images.ts';
import type { Printable } from './print-kernel.ts';
import { binderPlan, printPlannedBinder } from './print-targets.ts';
import { exporterOf, sha256Hex, type Provenance } from './provenance.ts';
import type { PdfRenderer } from './renderer.ts';

export type PdfExportDeps = {
  readonly db: Database;
  readonly files: FileStore;
  readonly renderer: PdfRenderer | null;
  readonly origin: string;
  readonly commit: string;
  readonly now: () => Date;
};

export type PdfExportResult = 'ready' | 'failed' | 'skipped';

type Run = { readonly deps: PdfExportDeps; readonly exportId: string; readonly at: Date };

const queuedRequestSchema = z.object({ target: binderRequestSchema, principal: principalSchema });
const PDF = 'application/pdf';

async function failed(run: Run, reason: ErrorReason): Promise<PdfExportResult> {
  await finishExport(run.deps.db, run.exportId, { kind: 'failed', reason }, run.at);
  return 'failed';
}

function hashOf(printed: Printed): Promise<string> {
  const input = printed.hashInput;
  return input.kind === 'hash' ? Promise.resolve(input.sha256) : sha256Hex(input.text);
}

async function provenanceOf(run: Run, actor: Principal, printed: Printed): Promise<Provenance> {
  return {
    source: `${run.deps.origin}${exportPath(run.exportId)}`,
    reference: printed.reference,
    filters: printed.filters,
    exportedBy: exporterOf(actor),
    exportedOn: formatDate(run.at),
    sha256: await hashOf(printed),
  };
}

async function rendered(
  run: Run,
  renderer: PdfRenderer,
  actor: Principal,
  printable: Printable,
): Promise<PdfExportResult> {
  const { db, files, origin } = run.deps;
  const provenance = await provenanceOf(run, actor, printable.printed);
  const image = fileImages(db, files, { actor, at: run.at }, origin);
  const { title, bodyHtml } = printable;
  const pdf = await renderer.render(await printJob({ title, bodyHtml, provenance, origin, image }));
  if (pdf === null) return failed(run, 'pdf_render_failed');
  const r2Key = exportKey(run.exportId);
  await files.put(r2Key, { bytes: pdf, contentType: PDF });
  const ready = { kind: 'ready', r2Key, sha256: provenance.sha256, bytes: pdf.byteLength } as const;
  await finishExport(db, run.exportId, ready, run.at);
  return 'ready';
}

export async function runPdfExport(
  deps: PdfExportDeps,
  start: PdfExportStart,
): Promise<PdfExportResult> {
  const queued = await queuedExport(deps.db, start.exportId);
  if (queued === null) return 'skipped';
  const run = { deps, exportId: start.exportId, at: deps.now() };
  const request = queuedRequestSchema.safeParse(queued.request);
  if (!request.success) return failed(run, 'malformed_command');
  if (deps.renderer === null) return failed(run, 'not_wired');
  const { target, principal } = request.data;
  const plan = await binderPlan(deps.db, principal, target, run.at);
  if (typeof plan === 'string') return failed(run, plan);
  const printable = await printPlannedBinder(deps.db, principal, plan, run.at, deps.commit);
  return rendered(run, deps.renderer, principal, printable);
}

export async function abandonPdfExport(
  deps: Pick<PdfExportDeps, 'db' | 'now'>,
  start: PdfExportStart,
  reason: ErrorReason,
): Promise<PdfExportResult> {
  await finishExport(deps.db, start.exportId, { kind: 'failed', reason }, deps.now());
  return 'failed';
}

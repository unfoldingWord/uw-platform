import { z } from 'zod';
import { binderRequestSchema, principalSchema, type ErrorReason } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import type { PdfExportStart } from '../env.ts';
import type { FileStore } from '../pages/file-store.ts';
import { personById } from '../people/directory.ts';
import { exportKey, exportPath, finishExport, queuedExport, type QueuedExport } from './exports.ts';
import { printJob, sourceHashOf, type Printed } from './print-document.ts';
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
type Rendering = {
  readonly actor: Principal;
  readonly printable: Printable;
  readonly queued: QueuedExport;
};

const queuedRequestSchema = z.object({ target: binderRequestSchema });
const HUMAN = 'human:';
const PDF = 'application/pdf';

async function failed(run: Run, reason: ErrorReason): Promise<PdfExportResult> {
  await finishExport(run.deps.db, run.exportId, { kind: 'failed', reason }, run.at);
  return 'failed';
}

async function provenanceOf(run: Run, actor: Principal, printed: Printed): Promise<Provenance> {
  return {
    source: `${run.deps.origin}${exportPath(run.exportId)}`,
    reference: printed.reference,
    filters: printed.filters,
    exportedBy: exporterOf(actor),
    exportedOn: formatDate(run.at),
    ...(await sourceHashOf(printed)),
  };
}

async function requesterNow(
  db: Database,
  queued: QueuedExport,
  at: Date,
): Promise<Principal | null> {
  const { requestedBy: identity, personId } = queued;
  const found = personId === null ? null : await personById(db, personId);
  const active = found?.status === 'active' && personId !== null;
  const person = identity.startsWith(HUMAN);
  const parsed = principalSchema.safeParse({
    identity,
    kind: person ? 'person' : 'agent',
    personId,
    email: person ? (found?.email ?? null) : null,
    grants: active ? await resolveGrants(db, personId, { at }) : [],
    interactive: false,
  });
  return parsed.success ? parsed.data : null;
}

async function rendered(
  run: Run,
  renderer: PdfRenderer,
  rendering: Rendering,
): Promise<PdfExportResult> {
  const { actor, printable, queued } = rendering;
  const { db, files, origin } = run.deps;
  const provenance = await provenanceOf(run, actor, printable.printed);
  const image = fileImages(db, files, { actor, at: run.at }, origin);
  const { title, bodyHtml } = printable;
  const pdf = await renderer.render(await printJob({ title, bodyHtml, provenance, origin, image }));
  if (pdf === null) return failed(run, 'pdf_render_failed');
  const r2Key = exportKey(run.exportId);
  await files.put(r2Key, { bytes: pdf, contentType: PDF });
  const hashes = { sourceSha256: provenance.sourceSha256, fileSha256: await sha256Hex(pdf) };
  const areas = [...new Set([...queued.areas, ...printable.areas])];
  const ready = { kind: 'ready', r2Key, ...hashes, bytes: pdf.byteLength, areas } as const;
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
  const principal = await requesterNow(deps.db, queued, run.at);
  if (principal === null) return failed(run, 'binder_empty');
  const { target } = request.data;
  const plan = await binderPlan(deps.db, principal, target, run.at);
  if (typeof plan === 'string') return failed(run, plan);
  const printable = await printPlannedBinder(deps.db, principal, plan, run.at, deps.commit);
  return rendered(run, deps.renderer, { actor: principal, printable, queued });
}

export async function abandonPdfExport(
  deps: Pick<PdfExportDeps, 'db' | 'now'>,
  start: PdfExportStart,
  reason: ErrorReason,
): Promise<PdfExportResult> {
  await finishExport(deps.db, start.exportId, { kind: 'failed', reason }, deps.now());
  return 'failed';
}

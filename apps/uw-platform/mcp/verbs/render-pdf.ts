import type { BinderRequest, PdfExportReply, RenderChannel } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import { loadCollectionById } from '../../collections/definitions.ts';
import { viewRow } from '../../collections/view-rows.ts';
import type { PdfExportBinding } from '../../env.ts';
import type { FileStore } from '../../pages/file-store.ts';
import {
  exportFilePath,
  queueExport,
  recordRender,
  startQueuedExport,
  storeReadyExport,
  withinRenderLimit,
} from '../../pdf/exports.ts';
import { printJob, sourceHashOf, type Printed } from '../../pdf/print-document.ts';
import { fileImages } from '../../pdf/print-images.ts';
import {
  binderPlan,
  binderReference,
  printPageIn,
  printView,
  type BinderPlan,
  type Printable,
} from '../../pdf/print-targets.ts';
import { exporterOf, type Provenance } from '../../pdf/provenance.ts';
import type { PdfRenderer } from '../../pdf/renderer.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal, type Found, type VerbInput, type VerbRefusal } from '../handler.ts';
import { storedPageArea } from './page-scene.ts';

type RenderInput = VerbInput<'render_pdf'>;
type Target = RenderInput['target'];
type Single = Extract<Target, { readonly kind: 'page' } | { readonly kind: 'view' }>;
type Binder = { readonly plan: BinderPlan; readonly request: BinderRequest };
type Scene = { readonly kind: 'single' } | ({ readonly kind: 'binder' } & Binder);
type Wired = { readonly pdf: PdfRenderer; readonly files: FileStore };

function hiddenTarget(input: RenderInput): VerbRefusal {
  const { target } = input;
  if (target.kind === 'page') return refusal('page_not_found', { pageId: target.pageId });
  return refusal(target.kind === 'view' ? 'view_not_found' : 'binder_empty');
}

async function viewArea(context: VerbContext, target: Extract<Target, { kind: 'view' }>) {
  await ensureBuiltIns(context.db, context.at);
  const row = await viewRow(context.db, target.viewId);
  const stored = row === null ? null : await loadCollectionById(context.db, row.collectionId);
  if (stored === null || stored.definition.key !== target.collection) {
    return refusal('view_not_found');
  }
  return { resource: { kind: 'area' as const, area: stored.definition.jdArea } };
}

function requestOf(
  target: Exclude<Target, Single>,
  title: string,
  channel: RenderChannel,
): BinderRequest {
  if ('rootPageId' in target) return { ...target, title, channel };
  return { kind: 'binder', title, pageIds: target.pageIds, channel };
}

async function binderArea(
  context: VerbContext,
  target: Exclude<Target, Single>,
  channel: RenderChannel,
): Promise<Found<Scene> | VerbRefusal> {
  const asked = requestOf(target, target.title ?? 'Binder', channel);
  const planned = await binderPlan(context.db, context.principal, asked, context.at);
  if (typeof planned === 'string') return refusal(planned);
  const title = target.title ?? planned.root?.title ?? planned.pages[0]?.title ?? 'Binder';
  const plan = { ...planned, title };
  const area = plan.areas[0] ?? '';
  const found = { kind: 'binder' as const, plan, request: requestOf(target, title, channel) };
  return { resource: { kind: 'area', area }, found };
}

async function targetArea(
  context: VerbContext,
  input: RenderInput,
): Promise<Found<Scene> | VerbRefusal> {
  const { target } = input;
  if (target.kind === 'binder') return binderArea(context, target, input.channel);
  const found =
    target.kind === 'page'
      ? await storedPageArea(context, target)
      : await viewArea(context, target);
  if ('status' in found) return found;
  return { resource: found.resource, found: { kind: 'single' } };
}

function sourceOf(context: VerbContext, target: Single): string {
  const path =
    target.kind === 'page'
      ? `/pages/${target.pageId}`
      : `/collections/${target.collection}/views/${target.viewId}`;
  return `${context.origin ?? ''}${path}`;
}

async function provenanceOf(
  context: VerbContext,
  target: Single,
  printed: Printed,
): Promise<Provenance> {
  return {
    source: sourceOf(context, target),
    reference: printed.reference,
    filters: printed.filters,
    exportedBy: exporterOf(context.principal),
    exportedOn: formatDate(context.at),
    ...(await sourceHashOf(printed)),
  };
}

function printableOf(
  context: VerbContext,
  target: Single,
  channel: RenderChannel,
): Promise<Printable | 'story_above_channel' | null> {
  const { db, principal, at, commit } = context;
  if (target.kind === 'page') {
    return printPageIn(db, principal, { pageId: target.pageId, at, commit }, channel);
  }
  return printView(db, principal, target.collection, target.viewId, at);
}

async function renderNow(
  context: VerbContext,
  wired: Wired,
  input: RenderInput & { readonly target: Single },
) {
  const { target, channel } = input;
  const printable = await printableOf(context, target, channel);
  if (printable === null) return hiddenTarget(input);
  if (printable === 'story_above_channel') return refusal(printable);
  const { title, bodyHtml, printed, areas } = printable;
  const provenance = await provenanceOf(context, target, printed);
  const origin = context.origin ?? '';
  const reader = { actor: context.principal, at: context.at, channel };
  const image = fileImages(context.db, wired.files, reader, origin);
  const pdf = await wired.pdf.render(
    await printJob({ title, bodyHtml, provenance, origin, image }),
  );
  const { reference, sourceSha256 } = provenance;
  const stored = { kind: target.kind, title, reference, areas, request: target };
  const drawn = { channel, stories: printable.stories };
  const asked = { ...stored, ...drawn, actor: context.principal, at: context.at };
  if (pdf === null) {
    await recordRender(context.db, asked, { kind: 'failed', reason: 'pdf_render_failed' });
    return refusal('pdf_render_failed');
  }
  const reply = await storeReadyExport(context.db, wired.files, { ...asked, pdf, sourceSha256 });
  return { status: 'accepted' as const, output: reply };
}

async function queueBinder(context: VerbContext, binder: Binder, start: PdfExportBinding) {
  const { plan, request } = binder;
  const queued = {
    kind: 'binder' as const,
    title: plan.title,
    reference: binderReference(plan),
    areas: plan.areas,
    request,
  };
  const at = context.at;
  const { exportId } = await queueExport(context.db, { ...queued, actor: context.principal, at });
  const begin = () =>
    start.create({ id: exportId, params: { exportId, traceId: context.traceId } });
  if (!(await startQueuedExport(context.db, exportId, at, begin))) return refusal('internal_error');
  const file = exportFilePath(exportId);
  const output: PdfExportReply = {
    exportId,
    status: 'queued',
    file,
    sourceSha256: null,
    fileSha256: null,
    bytes: null,
  };
  return { status: 'accepted' as const, output };
}

function isSingle(input: RenderInput): input is RenderInput & { readonly target: Single } {
  return input.target.kind !== 'binder';
}

export const renderPdfVerb = gatedHandler({
  name: 'render_pdf',
  hidden: hiddenTarget,
  resource: targetArea,
  run: async (context, input, scene) => {
    const { pdf, files } = context;
    if (!pdf || !files) return refusal('not_wired');
    if (!(await withinRenderLimit(context.db, context.principal, context.at))) {
      return refusal('export_limit_reached');
    }
    if (scene.kind === 'binder') {
      if (!context.pdfExport) return refusal('not_wired');
      return queueBinder(context, scene, context.pdfExport);
    }
    return isSingle(input) ? renderNow(context, { pdf, files }, input) : hiddenTarget(input);
  },
});

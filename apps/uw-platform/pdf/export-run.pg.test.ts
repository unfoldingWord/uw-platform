import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { memoryFiles, type FileStore } from '../pages/file-store.ts';
import { failingBrowser } from '../testing/browser.ts';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { runPdfExport, type PdfExportDeps } from './export-run.ts';
import { finishExport, queueExport, readExport } from './exports.ts';
import { browserPdf, recordingPdf, type PdfRenderer } from './renderer.ts';

const ORIGIN = 'https://app.example.test';

type World = {
  readonly db: Database;
  readonly reader: Principal;
  readonly root: string;
  readonly hidden: string;
};

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'run-editor', 'editor', '00-09');
  const other = await person(db, 'run-other', 'editor', '30-39');
  const root = await fileKnowledge(db, editor.email, '01', { title: 'Field guide', bodyMd: 'Go.' });
  await fileKnowledge(db, editor.email, '01', { title: 'Chapter', parentId: root.pageId });
  const hidden = await fileKnowledge(db, other.email, '31', { title: 'Hidden' });
  const reader = await personOn(db, editor.id, editor.email, new Date());
  return { db, reader, root: root.pageId, hidden: hidden.pageId };
}

function depsOf(made: World, renderer: PdfRenderer | null, files: FileStore = memoryFiles()) {
  const deps: PdfExportDeps = {
    db: made.db,
    files,
    renderer,
    origin: ORIGIN,
    commit: 'test-commit',
    now: () => new Date(),
  };
  return deps;
}

async function queued(made: World, request: unknown): Promise<string> {
  const at = new Date();
  const input = { kind: 'binder' as const, title: 'Field guide', reference: 'Field guide' };
  const { exportId } = await queueExport(made.db, {
    ...input,
    areas: ['00-09'],
    request,
    actor: made.reader,
    at,
  });
  return exportId;
}

const byRoot = (made: World) => ({ kind: 'binder', rootPageId: made.root });

async function rendersIntoTheBucket(db: Database): Promise<void> {
  const made = await world(db);
  const exportId = await queued(made, byRoot(made));
  const renderer = recordingPdf();
  const files = memoryFiles();
  const traceId = crypto.randomUUID();
  expect(await runPdfExport(depsOf(made, renderer, files), { exportId, traceId })).toBe('ready');
  const read = await readExport(db, made.reader, exportId, new Date());
  expect(read).toMatchObject({ status: 'ready', r2Key: `exports/${exportId}.pdf` });
  const stored = await files.get(`exports/${exportId}.pdf`);
  expect(new TextDecoder().decode(stored?.bytes)).toMatch(/^%PDF-1\.7/);
  expect(read?.bytes).toBe(stored?.bytes.byteLength);
  const [job] = renderer.jobs();
  expect(job?.html).toContain('Chapter');
  expect(job?.html).toContain(`${ORIGIN}/exports/${exportId}`);
  expect(job?.footer).toContain(`sha256:${read?.sha256?.slice(0, 12) ?? 'none'}`);
  expect(await runPdfExport(depsOf(made, renderer, files), { exportId, traceId })).toBe('skipped');
}

async function failureOf(made: World, request: unknown, renderer: PdfRenderer | null) {
  const exportId = await queued(made, request);
  const traceId = crypto.randomUUID();
  expect(await runPdfExport(depsOf(made, renderer), { exportId, traceId })).toBe('failed');
  return (await readExport(made.db, made.reader, exportId, new Date()))?.failure;
}

async function failsWithAClosedSetReason(db: Database): Promise<void> {
  const made = await world(db);
  const ready = recordingPdf();
  expect(await failureOf(made, byRoot(made), null)).toBe('not_wired');
  expect(await failureOf(made, byRoot(made), browserPdf(failingBrowser()))).toBe(
    'pdf_render_failed',
  );
  expect(await failureOf(made, { kind: 'binder', rootPageId: 'not-a-page' }, ready)).toBe(
    'malformed_command',
  );
  const unreadable = { kind: 'binder', title: 'Hidden', pageIds: [made.hidden] };
  expect(await failureOf(made, unreadable, ready)).toBe('binder_empty');
}

async function skipsAFinishedExport(db: Database): Promise<void> {
  const made = await world(db);
  const exportId = await queued(made, byRoot(made));
  await finishExport(db, exportId, { kind: 'failed', reason: 'pdf_render_failed' }, new Date());
  const renderer = recordingPdf();
  const start = { exportId, traceId: crypto.randomUUID() };
  expect(await runPdfExport(depsOf(made, renderer), start)).toBe('skipped');
  expect(renderer.jobs()).toEqual([]);
}

describe.skipIf(!testServer)('#198 the PDF export Workflow body', () => {
  it('#198 renders a queued binder as its requester and stores the PDF ready, once', () =>
    withAppDatabase(rendersIntoTheBucket));
  it('#198 finishes failed with a closed-set reason, never raw text', () =>
    withAppDatabase(failsWithAClosedSetReason));
  it('#198 leaves an export that is no longer queued alone', () =>
    withAppDatabase(skipsAFinishedExport));
});

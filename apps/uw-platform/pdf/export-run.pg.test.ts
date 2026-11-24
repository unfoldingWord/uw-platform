import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { pdfExports, people } from '@uw/db/schema';
import { revokeSeededGrant, seedGrant } from '@uw/db/test-seed';
import { memoryFiles, type FileStore } from '../pages/file-store.ts';
import { failingBrowser } from '../testing/browser.ts';
import { person } from '../testing/commands.ts';
import { agentOf, personOn } from '../testing/kernel.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { runPdfExport, type PdfExportDeps } from './export-run.ts';
import { finishExport, queueExport, readExport } from './exports.ts';
import { sha256Hex } from './provenance.ts';
import { browserPdf, recordingPdf, type PdfRenderer } from './renderer.ts';

const ORIGIN = 'https://app.example.test';
const quiet = createLogger(
  { traceId: 'trace', commit: 'test', route: 'workflow pdf-export', principal: null },
  () => undefined,
);

type World = {
  readonly db: Database;
  readonly reader: Principal;
  readonly readerGrant: string;
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
  return { db, reader, readerGrant: editor.grantId, root: root.pageId, hidden: hidden.pageId };
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

async function queued(made: World, request: unknown, actor = made.reader): Promise<string> {
  const at = new Date();
  const input = { kind: 'binder' as const, title: 'Field guide', reference: 'Field guide' };
  const { exportId } = await queueExport(made.db, {
    ...input,
    areas: ['00-09'],
    request,
    actor,
    at,
  });
  return exportId;
}

const byRoot = (made: World) => ({ kind: 'binder', rootPageId: made.root });

async function namesBothHashes(
  read: { readonly sourceSha256: string | null; readonly fileSha256: string | null } | null,
  bytes: Uint8Array | undefined,
  footer: string | undefined,
): Promise<void> {
  expect(footer).toContain(`source sha256:${read?.sourceSha256?.slice(0, 12) ?? 'none'}`);
  expect(read?.fileSha256).toBe(await sha256Hex(bytes ?? new Uint8Array()));
}

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
  await namesBothHashes(read, stored?.bytes, job?.footer);
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
  expect(await failureOf(made, byRoot(made), browserPdf(failingBrowser(), quiet))).toBe(
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

async function runAfter(made: World, exportId: string, renderer: PdfRenderer) {
  const start = { exportId, traceId: crypto.randomUUID() };
  return runPdfExport(depsOf(made, renderer), start);
}

async function revokedGrantPrintsNothing(db: Database): Promise<void> {
  const made = await world(db);
  const exportId = await queued(made, byRoot(made));
  await revokeSeededGrant(db, made.readerGrant, new Date(Date.now() - 1_000));
  const renderer = recordingPdf();
  expect(await runAfter(made, exportId, renderer)).toBe('failed');
  expect(renderer.jobs()).toEqual([]);
  const [row] = await queuedRow(made, exportId);
  expect(row).toMatchObject({ status: 'failed', failure: 'binder_empty', r2Key: null });
}

async function disabledPersonPrintsNothing(db: Database): Promise<void> {
  const made = await world(db);
  const exportId = await queued(made, byRoot(made), agentOf(made.reader, 'laptop'));
  await db
    .update(people)
    .set({ status: 'disabled' })
    .where(eq(people.id, made.reader.personId ?? ''));
  const renderer = recordingPdf();
  expect(await runAfter(made, exportId, renderer)).toBe('failed');
  expect(renderer.jobs()).toEqual([]);
  const [row] = await queuedRow(made, exportId);
  expect(row).toMatchObject({ status: 'failed', failure: 'binder_empty' });
}

async function printsOnlyWhatIsStillReadable(db: Database): Promise<void> {
  const made = await world(db);
  const other = await person(db, 'run-elsewhere', 'editor', '40-49');
  const elsewhere = await fileKnowledge(db, other.email, '41', { title: 'Elsewhere notes' });
  const grantId = randomUUID();
  const personId = made.reader.personId ?? '';
  const grantedAt = new Date(Date.now() - 60_000);
  const grant = { id: grantId, personId, role: 'viewer' as const, scopeKind: 'jd_area' as const };
  await seedGrant(db, { ...grant, scopeArea: '40-49', grantedAt, expiresAt: null });
  const pageIds = [made.root, elsewhere.pageId];
  const holder = await personOn(db, personId, made.reader.email ?? '', new Date());
  const exportId = await queued(made, { kind: 'binder', title: 'Both', pageIds }, holder);
  await revokeSeededGrant(db, grantId, new Date(Date.now() - 1_000));
  const renderer = recordingPdf();
  expect(await runAfter(made, exportId, renderer)).toBe('ready');
  const [job] = renderer.jobs();
  expect(job?.html).toContain('Field guide');
  expect(job?.html).not.toContain('Elsewhere notes');
  expect(job?.html).toContain(made.reader.email ?? 'no email');
}

async function queuedRow(made: World, exportId: string) {
  return made.db.select().from(pdfExports).where(eq(pdfExports.id, exportId));
}

describe.skipIf(!testServer)('#198 the PDF export Workflow renders as the requester now', () => {
  it('#198 prints nothing from an area whose grant was revoked after the request', () =>
    withAppDatabase(revokedGrantPrintsNothing));
  it('#198 prints nothing for an agent whose person was disabled after the request', () =>
    withAppDatabase(disabledPersonPrintsNothing));
  it('#198 prints only the pages the requester can still read, as their live self', () =>
    withAppDatabase(printsOnlyWhatIsStillReadable));
});

describe.skipIf(!testServer)('#198 the PDF export Workflow body', () => {
  it('#198 renders a queued binder as its requester and stores the PDF ready, once', () =>
    withAppDatabase(rendersIntoTheBucket));
  it('#198 finishes failed with a closed-set reason, never raw text', () =>
    withAppDatabase(failsWithAClosedSetReason));
  it('#198 leaves an export that is no longer queued alone', () =>
    withAppDatabase(skipsAFinishedExport));
});

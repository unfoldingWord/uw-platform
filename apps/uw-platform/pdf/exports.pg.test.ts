import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pdfExportReplySchema, type PdfExportReply, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant } from '@uw/db/test-seed';
import { memoryFiles } from '../pages/file-store.ts';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  expireExports,
  exportLifetimeDays,
  finishExport,
  queueExport,
  queuedExport,
  readExport,
  storeReadyExport,
} from './exports.ts';

const HASH = 'a'.repeat(64);
const DAY_MS = 86_400_000;

type World = {
  readonly requester: Principal;
  readonly both: Principal;
  readonly partial: Principal;
  readonly at: Date;
};

async function readerOf(db: Database, name: string, areas: readonly string[]): Promise<Principal> {
  const [first = '00-09', ...rest] = areas;
  const made = await person(db, name, 'viewer', first);
  for (const area of rest) {
    await seedGrant(db, {
      id: randomUUID(),
      personId: made.id,
      role: 'viewer',
      scopeKind: 'jd_area',
      scopeArea: area,
      grantedAt: new Date(Date.now() - 60_000),
      expiresAt: null,
    });
  }
  return personOn(db, made.id, made.email, new Date());
}

async function world(db: Database): Promise<World> {
  return {
    requester: await readerOf(db, 'export-requester', ['30-39', '40-49']),
    both: await readerOf(db, 'export-both', ['30-39', '40-49']),
    partial: await readerOf(db, 'export-partial', ['30-39']),
    at: new Date(),
  };
}

function binder(made: World) {
  return {
    kind: 'binder' as const,
    title: 'Board packet',
    reference: 'Board packet (2 pages)',
    areas: ['30-39', '40-49'],
    request: { kind: 'binder', title: 'Board packet', pageIds: [randomUUID()] },
    actor: made.requester,
    at: made.at,
  };
}

async function queuedReadsBack(db: Database): Promise<void> {
  const made = await world(db);
  const { exportId } = await queueExport(db, binder(made));
  const read = await readExport(db, made.requester, exportId, made.at);
  expect(read === null ? null : pdfExportReplySchema.parse(replyFields(read))).toEqual({
    exportId,
    status: 'queued',
    file: `/api/exports/${exportId}/file`,
    sha256: null,
    bytes: null,
  });
  expect(read?.title).toBe('Board packet');
  expect(read?.expiresAt.getTime()).toBe(made.at.getTime() + exportLifetimeDays * DAY_MS);
  const queued = await queuedExport(db, exportId);
  expect(queued?.request).toMatchObject({
    target: { kind: 'binder', title: 'Board packet' },
    principal: { identity: made.requester.identity },
  });
}

function replyFields(read: PdfExportReply): PdfExportReply {
  const { exportId, status, file, sha256, bytes } = read;
  return { exportId, status, file, sha256, bytes };
}

async function finishedReadyAndFailed(db: Database): Promise<void> {
  const made = await world(db);
  const ready = await queueExport(db, binder(made));
  const failed = await queueExport(db, binder(made));
  const key = `exports/${ready.exportId}.pdf`;
  await finishExport(
    db,
    ready.exportId,
    { kind: 'ready', r2Key: key, sha256: HASH, bytes: 1234 },
    made.at,
  );
  await finishExport(db, failed.exportId, { kind: 'failed', reason: 'pdf_render_failed' }, made.at);
  const readyRead = await readExport(db, made.both, ready.exportId, made.at);
  expect(readyRead).toMatchObject({ status: 'ready', sha256: HASH, bytes: 1234, r2Key: key });
  const failedRead = await readExport(db, made.both, failed.exportId, made.at);
  expect(failedRead).toMatchObject({
    status: 'failed',
    failure: 'pdf_render_failed',
    sha256: null,
  });
  expect(await queuedExport(db, ready.exportId)).toBeNull();
}

async function unreadableAreaHidesTheExport(db: Database): Promise<void> {
  const made = await world(db);
  const { exportId } = await queueExport(db, binder(made));
  expect(await readExport(db, made.partial, exportId, made.at)).toBeNull();
  expect(await readExport(db, made.both, exportId, made.at)).not.toBeNull();
  expect(await readExport(db, made.both, randomUUID(), made.at)).toBeNull();
}

async function storesAReadyExport(db: Database): Promise<void> {
  const made = await world(db);
  const files = memoryFiles();
  const pdf = new TextEncoder().encode('%PDF-1.7\n%stored\n');
  const reply = await storeReadyExport(db, files, {
    ...binder(made),
    kind: 'page',
    pdf,
    sha256: HASH,
  });
  expect(reply).toMatchObject({ status: 'ready', sha256: HASH, bytes: pdf.byteLength });
  const stored = await files.get(`exports/${reply.exportId}.pdf`);
  expect(stored?.contentType).toBe('application/pdf');
  expect(new TextDecoder().decode(stored?.bytes)).toBe('%PDF-1.7\n%stored\n');
}

async function expiresOldExports(db: Database): Promise<void> {
  const made = await world(db);
  const files = memoryFiles();
  const pdf = new TextEncoder().encode('%PDF-1.7\n');
  const old = await storeReadyExport(db, files, { ...binder(made), pdf, sha256: HASH });
  const later = new Date(made.at.getTime() + (exportLifetimeDays + 1) * DAY_MS);
  const fresh = await storeReadyExport(db, files, {
    ...binder(made),
    at: later,
    pdf,
    sha256: HASH,
  });
  expect(await expireExports(db, files, later)).toBe(1);
  expect(await files.get(`exports/${old.exportId}.pdf`)).toBeNull();
  expect(await files.get(`exports/${fresh.exportId}.pdf`)).not.toBeNull();
  expect(await readExport(db, made.both, old.exportId, later)).toMatchObject({
    status: 'expired',
    sha256: null,
    bytes: null,
  });
  expect(await expireExports(db, files, later)).toBe(0);
}

async function lapsedReadsAsExpired(db: Database): Promise<void> {
  const made = await world(db);
  const { exportId } = await queueExport(db, binder(made));
  const later = new Date(made.at.getTime() + (exportLifetimeDays + 1) * DAY_MS);
  expect(await readExport(db, made.both, exportId, later)).toMatchObject({ status: 'expired' });
}

describe.skipIf(!testServer)('#198 the PDF export record', () => {
  it('#198 queues an export that reads back queued, with no hash or size, for seven days', () =>
    withAppDatabase(queuedReadsBack));
  it('#198 finishes an export ready with its file, or failed with a closed-set reason', () =>
    withAppDatabase(finishedReadyAndFailed));
  it('#198 hides an export from a reader lacking any area it covers, and a missing one', () =>
    withAppDatabase(unreadableAreaHidesTheExport));
  it('#198 stores a rendered PDF in the bucket and records it ready', () =>
    withAppDatabase(storesAReadyExport));
  it('#198 deletes the file of an export past its lifetime and marks it expired', () =>
    withAppDatabase(expiresOldExports));
  it('#198 reads an export past its lifetime as expired before the nightly job runs', () =>
    withAppDatabase(lapsedReadsAsExpired));
});

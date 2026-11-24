import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  pdfExportReplySchema,
  principalSchema,
  type PdfExportReply,
  type Principal,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { pdfExports } from '@uw/db/schema';
import { seedGrant } from '@uw/db/test-seed';
import { memoryFiles } from '../pages/file-store.ts';
import { person } from '../testing/commands.ts';
import { agentOf, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { sha256Hex } from './provenance.ts';
import {
  dailyRenderLimit,
  expireExports,
  exportLifetimeDays,
  failStuckExports,
  finishExport,
  queueExport,
  queuedExport,
  readExport,
  recordRender,
  startQueuedExport,
  storeReadyExport,
  withinRenderLimit,
} from './exports.ts';

const HASH = 'a'.repeat(64);
const FILE_HASH = 'b'.repeat(64);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

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
  const asked = binder(made);
  const { exportId } = await queueExport(db, asked);
  const read = await readExport(db, made.requester, exportId, made.at);
  expect(read === null ? null : pdfExportReplySchema.parse(replyFields(read))).toEqual({
    exportId,
    status: 'queued',
    file: `/api/exports/${exportId}/file`,
    sourceSha256: null,
    fileSha256: null,
    bytes: null,
  });
  expect(read?.title).toBe('Board packet');
  expect(read?.expiresAt.getTime()).toBe(made.at.getTime() + exportLifetimeDays * DAY_MS);
  const queued = await queuedExport(db, exportId);
  expect(queued).toEqual({
    title: 'Board packet',
    request: { target: asked.request },
    requestedBy: made.requester.identity,
    personId: made.requester.personId,
  });
}

async function storesNoPrincipal(db: Database): Promise<void> {
  const made = await world(db);
  const files = memoryFiles();
  const asked = binder(made);
  const queued = await queueExport(db, asked);
  const pdf = new TextEncoder().encode('%PDF-1.7\n');
  const stored = await storeReadyExport(db, files, { ...asked, pdf, sourceSha256: HASH });
  for (const exportId of [queued.exportId, stored.exportId]) {
    const [row] = await db.select().from(pdfExports).where(eq(pdfExports.id, exportId));
    expect(row?.request).toEqual({ target: asked.request });
    expect(JSON.stringify(row)).not.toContain(made.requester.email ?? 'no email');
    expect(JSON.stringify(row)).not.toContain('grants');
  }
}

function replyFields(read: PdfExportReply): PdfExportReply {
  const { exportId, status, file, sourceSha256, fileSha256, bytes } = read;
  return { exportId, status, file, sourceSha256, fileSha256, bytes };
}

async function finishedReadyAndFailed(db: Database): Promise<void> {
  const made = await world(db);
  const ready = await queueExport(db, binder(made));
  const failed = await queueExport(db, binder(made));
  const key = `exports/${ready.exportId}.pdf`;
  await finishExport(
    db,
    ready.exportId,
    { kind: 'ready', r2Key: key, sourceSha256: HASH, fileSha256: FILE_HASH, bytes: 1234 },
    made.at,
  );
  await finishExport(db, failed.exportId, { kind: 'failed', reason: 'pdf_render_failed' }, made.at);
  const readyRead = await readExport(db, made.requester, ready.exportId, made.at);
  expect(readyRead).toMatchObject({
    status: 'ready',
    sourceSha256: HASH,
    fileSha256: FILE_HASH,
    bytes: 1234,
    r2Key: key,
  });
  const failedRead = await readExport(db, made.requester, failed.exportId, made.at);
  expect(failedRead).toMatchObject({
    status: 'failed',
    failure: 'pdf_render_failed',
    sourceSha256: null,
    fileSha256: null,
  });
  expect(await queuedExport(db, ready.exportId)).toBeNull();
}

async function onlyItsPersonReadsTheExport(db: Database): Promise<void> {
  const made = await world(db);
  const { exportId } = await queueExport(db, binder(made));
  expect(await readExport(db, made.requester, exportId, made.at)).not.toBeNull();
  expect(await readExport(db, made.both, exportId, made.at)).toBeNull();
  expect(await readExport(db, made.partial, exportId, made.at)).toBeNull();
  expect(await readExport(db, made.requester, randomUUID(), made.at)).toBeNull();
  const narrowed = { ...made.requester, grants: made.partial.grants };
  expect(await readExport(db, narrowed, exportId, made.at)).toBeNull();
}

const personless: Principal = principalSchema.parse({
  identity: 'agent:svc-exporter',
  kind: 'agent',
  personId: null,
  email: null,
  grants: [],
  interactive: false,
});

async function agentExportBelongsToItsPerson(db: Database): Promise<void> {
  const made = await world(db);
  const agent = agentOf(made.requester, 'laptop');
  const { exportId } = await queueExport(db, { ...binder(made), actor: agent });
  expect(await readExport(db, agent, exportId, made.at)).not.toBeNull();
  expect(await readExport(db, made.requester, exportId, made.at)).not.toBeNull();
  expect(await readExport(db, made.both, exportId, made.at)).toBeNull();
  expect(await readExport(db, agentOf(made.both, 'laptop'), exportId, made.at)).toBeNull();
  const orphan = await queueExport(db, { ...binder(made), actor: personless });
  const everyone = { ...personless, grants: made.both.grants };
  expect(await readExport(db, everyone, orphan.exportId, made.at)).toBeNull();
  expect(await readExport(db, made.both, orphan.exportId, made.at)).toBeNull();
}

async function storesAReadyExport(db: Database): Promise<void> {
  const made = await world(db);
  const files = memoryFiles();
  const pdf = new TextEncoder().encode('%PDF-1.7\n%stored\n');
  const reply = await storeReadyExport(db, files, {
    ...binder(made),
    kind: 'page',
    pdf,
    sourceSha256: HASH,
  });
  expect(reply).toMatchObject({
    status: 'ready',
    sourceSha256: HASH,
    fileSha256: await sha256Hex(pdf),
    bytes: pdf.byteLength,
  });
  const stored = await files.get(`exports/${reply.exportId}.pdf`);
  expect(stored?.contentType).toBe('application/pdf');
  expect(new TextDecoder().decode(stored?.bytes)).toBe('%PDF-1.7\n%stored\n');
}

async function expiresOldExports(db: Database): Promise<void> {
  const made = await world(db);
  const files = memoryFiles();
  const pdf = new TextEncoder().encode('%PDF-1.7\n');
  const old = await storeReadyExport(db, files, { ...binder(made), pdf, sourceSha256: HASH });
  const later = new Date(made.at.getTime() + (exportLifetimeDays + 1) * DAY_MS);
  const fresh = await storeReadyExport(db, files, {
    ...binder(made),
    at: later,
    pdf,
    sourceSha256: HASH,
  });
  expect(await expireExports(db, files, later)).toBe(1);
  expect(await files.get(`exports/${old.exportId}.pdf`)).toBeNull();
  expect(await files.get(`exports/${fresh.exportId}.pdf`)).not.toBeNull();
  expect(await readExport(db, made.requester, old.exportId, later)).toMatchObject({
    status: 'expired',
    sourceSha256: null,
    bytes: null,
  });
  expect(await expireExports(db, files, later)).toBe(0);
}

async function lapsedReadsAsExpired(db: Database): Promise<void> {
  const made = await world(db);
  const { exportId } = await queueExport(db, binder(made));
  const later = new Date(made.at.getTime() + (exportLifetimeDays + 1) * DAY_MS);
  expect(await readExport(db, made.requester, exportId, later)).toMatchObject({
    status: 'expired',
  });
}

async function failsExportsStuckInTheQueue(db: Database): Promise<void> {
  const made = await world(db);
  const stuck = await queueExport(db, binder(made));
  const recent = await queueExport(db, {
    ...binder(made),
    at: new Date(made.at.getTime() + HOUR_MS),
  });
  const later = new Date(made.at.getTime() + HOUR_MS + 1);
  expect(await failStuckExports(db, later)).toBe(1);
  expect(await readExport(db, made.requester, stuck.exportId, later)).toMatchObject({
    status: 'failed',
    failure: 'internal_error',
  });
  expect(await readExport(db, made.requester, recent.exportId, later)).toMatchObject({
    status: 'queued',
  });
  expect(await failStuckExports(db, later)).toBe(0);
}

async function failsAQueuedExportWhoseRunWouldNotStart(db: Database): Promise<void> {
  const made = await world(db);
  const started = await queueExport(db, binder(made));
  const begin = () => Promise.resolve({ id: started.exportId });
  expect(await startQueuedExport(db, started.exportId, made.at, begin)).toBe(true);
  expect(await queuedExport(db, started.exportId)).not.toBeNull();
  const refused = await queueExport(db, binder(made));
  const broken = () => Promise.reject(new Error('workflow refused'));
  expect(await startQueuedExport(db, refused.exportId, made.at, broken)).toBe(false);
  expect(await readExport(db, made.requester, refused.exportId, made.at)).toMatchObject({
    status: 'failed',
    failure: 'internal_error',
  });
}

function screenRender(actor: Principal, at: Date) {
  return {
    kind: 'screen' as const,
    title: 'Dashboard',
    reference: '/dashboard',
    areas: [],
    request: {},
    actor,
    at,
  };
}

async function countsRendersPerPersonForADay(db: Database): Promise<void> {
  const made = await world(db);
  const agent = agentOf(made.requester, 'laptop');
  const limit = 3;
  const printed = {
    kind: 'printed',
    sourceSha256: HASH,
    fileSha256: FILE_HASH,
    bytes: 10,
  } as const;
  const yesterday = new Date(made.at.getTime() - DAY_MS);
  await recordRender(db, screenRender(made.requester, yesterday), printed);
  expect(await withinRenderLimit(db, made.requester, made.at, limit)).toBe(true);
  await recordRender(db, screenRender(made.requester, made.at), printed);
  await queueExport(db, { ...binder(made), actor: agent });
  expect(await withinRenderLimit(db, agent, made.at, limit)).toBe(true);
  const failed = { kind: 'failed', reason: 'pdf_render_failed' } as const;
  await recordRender(db, { ...screenRender(agent, made.at), kind: 'page' }, failed);
  expect(await withinRenderLimit(db, made.requester, made.at, limit)).toBe(false);
  expect(await withinRenderLimit(db, agent, made.at, limit)).toBe(false);
  expect(await withinRenderLimit(db, made.both, made.at, limit)).toBe(true);
  expect(dailyRenderLimit).toBe(200);
}

async function countsAPersonlessAgentByItsIdentity(db: Database): Promise<void> {
  const made = await world(db);
  const printed = {
    kind: 'printed',
    sourceSha256: HASH,
    fileSha256: FILE_HASH,
    bytes: 10,
  } as const;
  await recordRender(db, screenRender(personless, made.at), printed);
  expect(await withinRenderLimit(db, personless, made.at, 1)).toBe(false);
  const other = principalSchema.parse({ ...personless, identity: 'agent:svc-other' });
  expect(await withinRenderLimit(db, other, made.at, 1)).toBe(true);
  expect(await withinRenderLimit(db, made.requester, made.at, 1)).toBe(true);
}

async function screenRendersAreNeverDownloadable(db: Database): Promise<void> {
  const made = await world(db);
  const printed = {
    kind: 'printed',
    sourceSha256: HASH,
    fileSha256: FILE_HASH,
    bytes: 10,
  } as const;
  const exportId = await recordRender(db, screenRender(made.requester, made.at), printed);
  const [row] = await db.select().from(pdfExports).where(eq(pdfExports.id, exportId));
  expect(row).toMatchObject({
    kind: 'screen',
    status: 'ready',
    r2Key: null,
    sourceSha256: HASH,
    fileSha256: FILE_HASH,
  });
  expect(await readExport(db, made.requester, exportId, made.at)).toBeNull();
}

describe.skipIf(!testServer)('#198 the PDF export record', () => {
  it('#198 queues an export that reads back queued, with no hash or size, for seven days', () =>
    withAppDatabase(queuedReadsBack));
  it('#198 finishes an export ready with its file, or failed with a closed-set reason', () =>
    withAppDatabase(finishedReadyAndFailed));
  it('#198 answers an export only to its person while they read every area, else as missing', () =>
    withAppDatabase(onlyItsPersonReadsTheExport));
  it('#198 an agent export belongs to the person the agent acts for, a personless one to nobody', () =>
    withAppDatabase(agentExportBelongsToItsPerson));
  it('#198 keeps only the identity and person of the requester, never their email or grants', () =>
    withAppDatabase(storesNoPrincipal));
  it('#198 fails an export queued for more than an hour with internal_error', () =>
    withAppDatabase(failsExportsStuckInTheQueue));
  it('#198 fails a queued export whose run would not start, before answering', () =>
    withAppDatabase(failsAQueuedExportWhoseRunWouldNotStart));
  it('#198 counts every render of the last day against the person, agents included', () =>
    withAppDatabase(countsRendersPerPersonForADay));
  it('#198 counts a personless agent against its own identity', () =>
    withAppDatabase(countsAPersonlessAgentByItsIdentity));
  it('#198 records a screen render ready with no file, never downloadable', () =>
    withAppDatabase(screenRendersAreNeverDownloadable));
  it('#198 stores a rendered PDF in the bucket and records it ready', () =>
    withAppDatabase(storesAReadyExport));
  it('#198 deletes the file of an export past its lifetime and marks it expired', () =>
    withAppDatabase(expiresOldExports));
  it('#198 reads an export past its lifetime as expired before the nightly job runs', () =>
    withAppDatabase(lapsedReadsAsExpired));
});

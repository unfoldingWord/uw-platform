import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pdfExportReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { FilesBucket } from '../env.ts';
import { memoryBucket } from '../testing/files.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  exportDeps,
  exportEnv,
  queuedStoryBinder,
  renderPdfAs,
  storyExportWorld,
  type StoryExportWorld,
} from '../testing/story-exports.ts';
import { getWithBindings } from '../testing/views.ts';
import { setStoryLevel, withdrawStoryConsent } from '../stories/levels.ts';
import { runPdfExport } from './export-run.ts';
import { recordingPdf } from './renderer.ts';

type Download = { readonly status: number; readonly reason: unknown };

async function download(
  made: StoryExportWorld,
  bucket: FilesBucket,
  exportId: string,
): Promise<Download> {
  const path = `/api/exports/${exportId}/file`;
  const sent = await getWithBindings(made.db, made.email, path, { FILES: bucket });
  if (sent.headers.get('content-type') === 'application/pdf') return { status: 200, reason: null };
  const body = JSON.parse(new TextDecoder().decode(sent.bytes)) as { reason?: unknown };
  return { status: sent.status, reason: body.reason };
}

async function exportScreen(made: StoryExportWorld, bucket: FilesBucket, exportId: string) {
  const sent = await getWithBindings(made.db, made.email, `/exports/${exportId}`, {
    FILES: bucket,
  });
  return new JSDOM(new TextDecoder().decode(sent.bytes)).window.document;
}

async function withdraw(made: StoryExportWorld): Promise<void> {
  const requestId = randomUUID();
  const command = { command: 'withdraw_story_consent', requestId, pageId: made.story } as const;
  const outcome = await withdrawStoryConsent(made.db, made.admin, command, new Date());
  expect(outcome.ok).toBe(true);
}

async function singlePageFollowsWithdrawal(db: Database): Promise<void> {
  const made = await storyExportWorld(db);
  const bucket = memoryBucket();
  const asked = { target: { kind: 'page', pageId: made.story }, channel: 'newsletter' };
  const reply = pdfExportReplySchema.parse(await renderPdfAs(made, asked, exportEnv(bucket)));
  expect(await download(made, bucket, reply.exportId)).toEqual({ status: 200, reason: null });
  await withdraw(made);
  expect(await download(made, bucket, reply.exportId)).toEqual({
    status: 409,
    reason: 'consent_withdrawn',
  });
  const screen = await exportScreen(made, bucket, reply.exportId);
  expect(screen.querySelector(`a[href="${reply.file}"]`)).toBeNull();
  expect(screen.querySelector('main')?.textContent).toContain('Consent withdrawn');
}

async function readyBinder(made: StoryExportWorld, bucket: FilesBucket, channel: string) {
  const exportId = await queuedStoryBinder(made, channel);
  const start = { exportId, traceId: randomUUID() };
  expect(await runPdfExport(exportDeps(made, recordingPdf(), bucket), start)).toBe('ready');
  return exportId;
}

async function binderFollowsTheLevel(db: Database): Promise<void> {
  const made = await storyExportWorld(db);
  const bucket = memoryBucket();
  const letter = await readyBinder(made, bucket, 'newsletter');
  const staff = await readyBinder(made, bucket, 'platform');
  expect(await download(made, bucket, letter)).toEqual({ status: 200, reason: null });
  const requestId = randomUUID();
  const lowered = { command: 'set_story_level', requestId, pageId: made.story } as const;
  const outcome = await setStoryLevel(
    db,
    made.admin,
    { ...lowered, level: 'internal' },
    new Date(),
  );
  expect(outcome).toEqual({ ok: true });
  expect(await download(made, bucket, letter)).toEqual({
    status: 403,
    reason: 'story_above_channel',
  });
  await withdraw(made);
  expect(await download(made, bucket, staff)).toEqual({ status: 200, reason: null });
}

describe.skipIf(!testServer)('ADR 0041 a stored export is rechecked at download', () => {
  it('ADR 0041 a newsletter PDF of a story is refused once its consent is withdrawn, shown in place', () =>
    withAppDatabase(singlePageFollowsWithdrawal));
  it('ADR 0041 a newsletter binder is refused once the story falls below its channel; a platform binder is not', () =>
    withAppDatabase(binderFollowsTheLevel));
});

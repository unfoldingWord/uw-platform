import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { pdfExports, pages } from '@uw/db/schema';
import { browserDoingFirst } from '../testing/browser.ts';
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
import { storyUsesOf } from '../stories/uses.ts';
import { runPdfExport } from './export-run.ts';
import { recordingPdf, type PdfRenderer } from './renderer.ts';

async function bumpVersion(db: Database, pageId: string): Promise<void> {
  await db
    .update(pages)
    .set({ version: sql`${pages.version} + 1` })
    .where(eq(pages.id, pageId));
}

async function refuseStoryUses(db: Database): Promise<void> {
  await db.execute(sql`CREATE FUNCTION test_refuse_story_use() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'story use refused for this test'; END $$`);
  await db.execute(
    sql`CREATE TRIGGER test_refuse_story_use BEFORE INSERT ON story_uses FOR EACH ROW EXECUTE FUNCTION test_refuse_story_use()`,
  );
}

async function allowStoryUses(db: Database): Promise<void> {
  await db.execute(sql`DROP TRIGGER test_refuse_story_use ON story_uses`);
}

async function statusOf(db: Database, exportId: string): Promise<string | undefined> {
  const [row] = await db.select().from(pdfExports).where(eq(pdfExports.id, exportId));
  return row?.status;
}

async function binderReadyOnlyWithItsUses(db: Database): Promise<void> {
  const made = await storyExportWorld(db);
  const exportId = await queuedStoryBinder(made);
  await refuseStoryUses(db);
  const start = { exportId, traceId: randomUUID() };
  await expect(runPdfExport(exportDeps(made, recordingPdf()), start)).rejects.toThrow();
  expect(await statusOf(db, exportId)).toBe('queued');
  await allowStoryUses(db);
  expect(await runPdfExport(exportDeps(made, recordingPdf()), start)).toBe('ready');
  const uses = await storyUsesOf(db, made.story);
  expect(uses.map(({ reference, kind }) => ({ reference, kind }))).toEqual([
    { reference: exportId, kind: 'pdf_binder' },
  ]);
}

function bumpingRenderer(made: StoryExportWorld): PdfRenderer {
  const inner = recordingPdf();
  return {
    render: async (job) => {
      await bumpVersion(made.db, made.story);
      return inner.render(job);
    },
  };
}

async function binderLogsTheVersionPrinted(db: Database): Promise<void> {
  const made = await storyExportWorld(db);
  const exportId = await queuedStoryBinder(made);
  const start = { exportId, traceId: randomUUID() };
  expect(await runPdfExport(exportDeps(made, bumpingRenderer(made)), start)).toBe('ready');
  const uses = await storyUsesOf(db, made.story);
  expect(uses.map(({ version }) => version)).toEqual([1]);
}

async function pageReadyOnlyWithItsUses(db: Database): Promise<void> {
  const made = await storyExportWorld(db);
  await refuseStoryUses(db);
  const asked = { target: { kind: 'page', pageId: made.story }, channel: 'newsletter' };
  expect(await renderPdfAs(made, asked, exportEnv())).toMatchObject({ status: 'error' });
  expect((await db.select().from(pdfExports)).map((row) => row.status)).not.toContain('ready');
  await allowStoryUses(db);
  expect(await renderPdfAs(made, asked, exportEnv())).toMatchObject({ status: 'ready' });
  expect(await storyUsesOf(db, made.story)).toHaveLength(1);
}

async function pageLogsTheVersionPrinted(db: Database): Promise<void> {
  const made = await storyExportWorld(db);
  const asked = { target: { kind: 'page', pageId: made.host }, channel: 'newsletter' };
  const env = exportEnv(
    memoryBucket(),
    browserDoingFirst(() => bumpVersion(db, made.story)),
  );
  expect(await renderPdfAs(made, asked, env)).toMatchObject({ status: 'ready' });
  const uses = await storyUsesOf(db, made.story);
  expect(uses.map(({ version }) => version)).toEqual([1]);
}

describe.skipIf(!testServer)('ADR 0041 a ready export and its story uses commit together', () => {
  it('ADR 0041 a binder stays queued when its story uses cannot be recorded, and a retry finishes it', () =>
    withAppDatabase(binderReadyOnlyWithItsUses));
  it('ADR 0041 a single-page export is not stored ready when its story uses cannot be recorded', () =>
    withAppDatabase(pageReadyOnlyWithItsUses));
});

describe.skipIf(!testServer)('ADR 0041 a story use names the version printed', () => {
  it('ADR 0041 a binder logs the story version it drew, though the story changed while it printed', () =>
    withAppDatabase(binderLogsTheVersionPrinted));
  it('ADR 0041 a single-page export logs the embedded story version it drew', () =>
    withAppDatabase(pageLogsTheVersionPrinted));
});

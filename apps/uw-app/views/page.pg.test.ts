import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import {
  accepted,
  callerOf,
  command,
  rowan,
  softwareHarness,
  type Scene,
} from '../testing/commands.ts';
import { contextPages } from '../pages/context.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ROWAN = 'rowan.test@unfoldingword.org';
const ORIGIN = { origin: 'http://localhost' };

type World = Scene & { readonly stageId: string; readonly stageTitle: string };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

const controlsOf = (harnessId: string) => `/harnesses/${harnessId}/controls`;

async function world(db: Database): Promise<World> {
  const scene = await softwareHarness(db);
  const admin = await rowan(db);
  const kernel = kernelOn(db, { now: () => new Date() });
  const view = accepted(
    await kernel.views.stageControls(callerOf(admin), { harnessId: scene.harnessId }),
  );
  const [stage] = view.stages;
  if (stage === undefined) throw new Error('the software workflow has no stages');
  return { ...scene, stageId: stage.id, stageTitle: stage.title };
}

function addInstructions(db: Database, email: string, made: World, title: string) {
  const body = { requestId: crypto.randomUUID(), stageId: made.stageId, title };
  return command(db, { email }, made.harnessId, 'add_stage_instructions', body);
}

async function stagePage(db: Database, made: World): Promise<string | null> {
  const kernel = kernelOn(db, { now: () => new Date() });
  const caller = callerOf(await rowan(db));
  const view = accepted(await kernel.views.stageControls(caller, { harnessId: made.harnessId }));
  return view.stages.find((stage) => stage.id === made.stageId)?.instructionsPageId ?? null;
}

async function created(db: Database, made: World, title = 'How to package an item') {
  const sent = await addInstructions(db, ROWAN, made, title);
  expect(sent.body).toMatchObject({ status: 'accepted' });
  const pageId = await stagePage(db, made);
  expect(pageId).not.toBeNull();
  return { pageId: pageId ?? '' };
}

async function adminCreatesAndAttaches(db: Database): Promise<void> {
  const made = await world(db);
  const { pageId } = await created(db, made);
  const controls = documentOf((await getHtml(db, ROWAN, controlsOf(made.harnessId))).text);
  const picked = controls.querySelector('select[name="stage.0.instructionsPageId"]');
  expect((picked as HTMLSelectElement | null)?.value).toBe(pageId);
  const open = controls.querySelector(`a[href^="/pages/${pageId}"]`);
  expect(open?.textContent).toContain('Open');
  const editor = await getHtml(db, ROWAN, open?.getAttribute('href') ?? '');
  expect(editor.status).toBe(200);
  expect(await screenProblems(editor.text)).toEqual([]);
  const document = documentOf(editor.text);
  expect(document.querySelector('main h1')?.textContent).toBe('How to package an item');
  expect(document.querySelector(`a[href="${controlsOf(made.harnessId)}"]`)).not.toBeNull();
}

function editForm(version: number, bodyMd: string): URLSearchParams {
  return new URLSearchParams({
    requestId: crypto.randomUUID(),
    expectedVersion: String(version),
    title: 'How to package an item',
    bodyMd,
  });
}

function historyRows(text: string): readonly string[] {
  return [...documentOf(text).querySelectorAll('main tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim() ?? '').join(' | '),
  );
}

async function editorSavesAVersion(db: Database): Promise<void> {
  const made = await world(db);
  const { pageId } = await created(db, made);
  const path = `/pages/${pageId}`;
  const before = documentOf((await getHtml(db, made.editor.email, path)).text);
  const version = Number(
    before.querySelector('input[name="expectedVersion"]')?.getAttribute('value'),
  );
  const saved = await postForm(
    db,
    made.editor.email,
    path,
    editForm(version, 'Keep it small.'),
    ORIGIN,
  );
  expect(saved.status).toBe(200);
  expect(saved.text).toContain('Saved as a new version.');
  expect(documentOf(saved.text).querySelector('textarea[name="bodyMd"]')?.textContent).toBe(
    'Keep it small.',
  );
  const [newest] = historyRows(saved.text);
  expect(newest?.startsWith(`${String(version + 1)} | `)).toBe(true);
  expect(newest).toContain(`| ${made.editor.email} |`);
  const admin = await rowan(db);
  const scope = { itemPageId: null, instructionsPageId: pageId, area: '80-89' as const };
  const context = await contextPages(db, admin, scope, new Date(), () => undefined);
  expect(context.instructions?.bodyMd).toBe('Keep it small.');
  const stale = await postForm(db, made.editor.email, path, editForm(version, 'Late.'), ORIGIN);
  expect(stale.text).toContain('Someone saved a newer version');
}

async function viewerOnlyReads(db: Database): Promise<void> {
  const made = await world(db);
  const { pageId } = await created(db, made);
  const page = await getHtml(db, made.viewer.email, `/pages/${pageId}`);
  expect(page.status).toBe(200);
  const document = documentOf(page.text);
  expect(document.querySelector('main form')).toBeNull();
  expect(document.querySelector('main pre')?.textContent).toContain('How to package an item');
  expect(historyRows(page.text)).not.toHaveLength(0);
  const sent = await postForm(
    db,
    made.viewer.email,
    `/pages/${pageId}`,
    editForm(2, 'No.'),
    ORIGIN,
  );
  expect(sent.text).toContain('Not saved');
}

async function skillPagesIn(db: Database): Promise<number> {
  const rows = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM pages WHERE type = 'skill' AND jd_area = '80-89'`,
  );
  return rows[0]?.count ?? -1;
}

async function refusedAttachLeavesNoPage(db: Database): Promise<void> {
  const made = await world(db);
  const kernel = kernelOn(db, { now: () => new Date() });
  accepted(await kernel.drafts.open(callerOf(await rowan(db)), { harnessId: made.harnessId }));
  const before = await skillPagesIn(db);
  const sent = await addInstructions(db, ROWAN, made, 'Blocked by a draft');
  expect(sent.body).toMatchObject({ status: 'error', reason: 'draft_locked' });
  expect(await skillPagesIn(db)).toBe(before);
  expect(await stagePage(db, made)).toBeNull();
}

async function editorMayNotCreate(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.editor.email, controlsOf(made.harnessId));
  const controls = documentOf(page.text);
  expect(controls.querySelector('form[data-command="add_stage_instructions"]')).toBeNull();
  const sent = await addInstructions(db, made.editor.email, made, 'Sneaky');
  expect(sent.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(await stagePage(db, made)).toBeNull();
}

describe.skipIf(!testServer)(
  '#129 a stage instructions page, opened and edited from Stages & Controls',
  () => {
    it('an admin creates a page for a stage, the stage uses it, and the picker links to it', () =>
      withAppDatabase(adminCreatesAndAttaches));

    it('an editor saves a new version, the history names them, and a stale save is refused', () =>
      withAppDatabase(editorSavesAVersion));

    it('a viewer reads the page and its history but cannot save', () =>
      withAppDatabase(viewerOnlyReads));

    it('a refused attach, such as a held workflow draft, leaves no new page behind', () =>
      withAppDatabase(refusedAttachLeavesNoPage));

    it('an editor gets no new-page form, and add_stage_instructions from one is not_permitted', () =>
      withAppDatabase(editorMayNotCreate));
  },
);

import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import type { Clock } from '@uw/harness';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { callerOf } from '../testing/commands.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { flowPath } from './parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-02T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };

type Scene = BoardWorld & { readonly ana: { readonly id: string; readonly email: string } };

async function inDraft(work: (scene: Scene) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => {
    const world = await boardWorld(db, seedClock);
    const ana = { id: randomUUID(), email: 'ana.draft@unfoldingword.org' };
    await seedPerson(db, ana);
    await seedGrant(db, {
      id: randomUUID(),
      personId: ana.id,
      role: 'admin',
      scopeKind: 'jd_area',
      scopeArea: '80-89',
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
    });
    await work({ ...world, ana });
  });
}

async function flowFor(scene: Scene, email: string): Promise<{ text: string; document: Document }> {
  const page = await getHtml(scene.db, email, flowPath(scene.harnessId), {}, viewClock);
  return { text: page.text, document: new JSDOM(page.text).window.document };
}

const startedAt = new Date('2026-10-02T08:56:00.000Z');

async function rowanDrafts(scene: Scene, feeds: readonly string[] = []): Promise<void> {
  const kernel = kernelOn(scene.db, { now: () => startedAt });
  const caller = callerOf(scene.rowan);
  const opened = await kernel.drafts.open(caller, { harnessId: scene.harnessId });
  if (opened.status !== 'accepted') throw new Error(`refused: ${opened.reason}`);
  const [first, ...rest] = opened.value.stages;
  if (first === undefined) throw new Error('expected stages');
  const saved = await kernel.drafts.save(caller, {
    harnessId: scene.harnessId,
    revision: opened.value.revision,
    stages: [{ ...first, feeds: [...first.feeds, ...feeds] }, ...rest],
  });
  if (saved.status !== 'accepted') throw new Error(`refused: ${saved.reason}`);
}

async function offersEditToAdminsOnly(scene: Scene): Promise<void> {
  const admin = await flowFor(scene, scene.rowanEmail);
  expect(admin.document.querySelector('form[data-command="open_workflow_draft"]')).not.toBeNull();
  const viewer = await flowFor(scene, scene.viewer.email);
  expect(viewer.document.querySelector('form[data-command="open_workflow_draft"]')).toBeNull();
}

async function holderEdits(scene: Scene): Promise<void> {
  await rowanDrafts(scene);
  const { document, text } = await flowFor(scene, scene.rowanEmail);
  const editor = document.querySelector('[data-draft-editor]');
  expect(editor?.getAttribute('data-revision')).toBe('2');
  expect(editor?.querySelectorAll('[data-draft-rows] > [data-draft-row]').length).toBeGreaterThan(
    3,
  );
  expect(document.querySelector('[data-draft-status]')?.textContent).toBe(
    '✓ Checked: every path reaches an end, and a person approves before any merge.',
  );
  expect(document.querySelector('[data-draft-publish]')?.hasAttribute('aria-disabled')).toBe(false);
  expect(document.querySelector('form[data-command="discard_workflow_draft"]')).not.toBeNull();
  expect(await screenProblems(text)).toEqual([]);
}

async function holderSeesProblems(scene: Scene): Promise<void> {
  await rowanDrafts(scene, ['gone']);
  const { document } = await flowFor(scene, scene.rowanEmail);
  const first = document.querySelector('[data-draft-rows] > [data-draft-row]');
  expect(first?.querySelector('[data-problems] [data-code]')?.getAttribute('data-code')).toBe(
    'unknown_loop_target',
  );
  expect(document.querySelector('[data-draft-publish]')?.getAttribute('aria-disabled')).toBe(
    'true',
  );
}

async function anotherAdminWatches(scene: Scene): Promise<void> {
  await rowanDrafts(scene);
  const { document, text } = await flowFor(scene, scene.ana.email);
  expect(document.querySelector('[data-lock-bar]')?.textContent).toBe(
    'Rowan Test is editing this workflow (started 4 min ago). The live workflow is unchanged until they publish.',
  );
  expect(document.querySelector('[data-draft-editor]')).toBeNull();
  const inputs = [
    ...document.querySelectorAll('[data-draft-view] input, [data-draft-view] select'),
  ];
  expect(inputs.length).toBeGreaterThan(0);
  expect(inputs.every((input) => input.hasAttribute('disabled'))).toBe(true);
  expect(document.querySelector('form[data-command="take_over_workflow_draft"]')).not.toBeNull();
  expect(document.querySelector('form[data-command="open_workflow_draft"]')).toBeNull();
  expect(await screenProblems(text)).toEqual([]);
}

async function memberSeesOnlyTheLock(scene: Scene): Promise<void> {
  await rowanDrafts(scene);
  const { document } = await flowFor(scene, scene.viewer.email);
  expect(document.querySelector('[data-lock-bar]')?.textContent).toContain('Rowan Test is editing');
  expect(document.querySelector('[data-draft-view]')).toBeNull();
  expect(document.querySelector('form[data-command="take_over_workflow_draft"]')).toBeNull();
}

async function lapsedLockOffersPickUp(scene: Scene): Promise<void> {
  await rowanDrafts(scene);
  const later = { now: () => new Date('2026-10-02T10:00:00.000Z') };
  const page = await getHtml(scene.db, scene.ana.email, flowPath(scene.harnessId), {}, later);
  const document = new JSDOM(page.text).window.document;
  expect(document.querySelector('[data-lock-bar]')?.textContent).toContain('their lock has lapsed');
  const pickUp = document.querySelector('form[data-command="open_workflow_draft"] button');
  expect(pickUp?.textContent?.trim()).toBe('Pick up their draft');
  const reader = await personOn(scene.db, scene.ana.id, scene.ana.email, later.now());
  expect(reader.personId).toBe(scene.ana.id);
}

async function holderMapsTheDraft(scene: Scene): Promise<void> {
  await rowanDrafts(scene, ['ship']);
  const { document } = await flowFor(scene, scene.rowanEmail);
  const map = document.querySelector('[data-draft-editor] [data-draft-map] svg[data-map-editable]');
  expect(map).not.toBeNull();
  const rows = [...document.querySelectorAll('[data-draft-rows] > [data-draft-row]')];
  const boxes = [...(map?.querySelectorAll('[data-box]') ?? [])];
  expect(boxes.map((box) => box.getAttribute('data-stage'))).toEqual(
    rows.map((row) => row.getAttribute('data-key')),
  );
  expect(map?.querySelectorAll('[data-loop-handle]')).toHaveLength(rows.length);
  const first = rows[0]?.getAttribute('data-key') ?? '';
  expect(map?.querySelector(`[data-loop="${first} ship"]`)?.getAttribute('tabindex')).toBe('0');
  const ship = [...(map?.querySelectorAll('[data-stage="ship"] text') ?? [])].map(
    (text) => text.textContent,
  );
  expect(ship.at(-1)).toBe('A person approves');
  expect(document.querySelectorAll('main svg[data-map-editable]')).toHaveLength(1);
}

async function watcherSeesTheDraftMapReadOnly(scene: Scene): Promise<void> {
  await rowanDrafts(scene, ['ship']);
  const { document } = await flowFor(scene, scene.ana.email);
  const map = document.querySelector('[data-draft-view] [data-draft-map] svg');
  expect(map).not.toBeNull();
  expect(map?.hasAttribute('data-map-editable')).toBe(false);
  expect(map?.querySelectorAll('[data-loop-handle], [data-loop], [data-box]')).toHaveLength(0);
  expect(map?.querySelectorAll('[data-feeds]').length).toBeGreaterThan(2);
  const member = await flowFor(scene, scene.viewer.email);
  expect(member.document.querySelector('[data-draft-map]')).toBeNull();
}

describe.skipIf(!testServer)('#103 the Flow tab edits a workflow as a draft', () => {
  it('offers Edit workflow to an area admin and not to a viewer', () =>
    inDraft(offersEditToAdminsOnly));

  it('shows the holder the draft bar, one editable row per stage, a clean check and Publish', () =>
    inDraft(holderEdits));

  it('puts a problem on its stage and turns Publish off', () => inDraft(holderSeesProblems));

  it('shows a second admin who is editing and since when, the draft read-only, and Take over', () =>
    inDraft(anotherAdminWatches));

  it('shows a viewer who is editing, but not the draft', () => inDraft(memberSeesOnlyTheLock));

  it('offers to pick up a draft once its lock has lapsed', () => inDraft(lapsedLockOffersPickUp));

  it('#109 draws the holder’s draft as a map with a box per row, loop handles and deletable loops', () =>
    inDraft(holderMapsTheDraft));

  it('#109 shows a second admin the draft map read-only, and a viewer no draft map', () =>
    inDraft(watcherSeesTheDraftMapReadOnly));
});

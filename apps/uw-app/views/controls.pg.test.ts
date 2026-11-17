import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { callerOf } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { controlsPath, flowPath } from './parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-02T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };

async function inWorld(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, seedClock)));
}

async function controlsFor(
  world: BoardWorld,
  email: string,
): Promise<{ text: string; status: number; document: Document }> {
  const page = await getHtml(world.db, email, controlsPath(world.harnessId), {}, viewClock);
  return { ...page, document: new JSDOM(page.text).window.document };
}

const switchCommands = ['set_hosted_builder', 'set_shadow', 'set_freeze'];

async function adminEdits(world: BoardWorld): Promise<void> {
  const { document, text, status } = await controlsFor(world, world.rowanEmail);
  expect(status).toBe(200);
  const rules = document.querySelector('form[data-command="set_stage_rules"]');
  expect(rules?.getAttribute('id')).toBe('stage-rules');
  expect(document.querySelectorAll('table tbody tr').length).toBeGreaterThan(3);
  const pickup = document.querySelector('select[name="stage.0.agentPickup"]');
  expect(pickup?.getAttribute('form')).toBe('stage-rules');
  expect(pickup?.hasAttribute('disabled')).toBe(false);
  expect(document.querySelector('input[name="stage.0.id"]')?.getAttribute('form')).toBe(
    'stage-rules',
  );
  for (const command of switchCommands)
    expect(document.querySelector(`form[data-command="${command}"]`)).not.toBeNull();
  expect(document.querySelector('form[data-command="pause"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Applies to everyone on this workflow');
  expect(document.body.textContent).not.toContain('View only');
  expect(await screenProblems(text)).toEqual([]);
}

async function memberSeesViewOnly(world: BoardWorld): Promise<void> {
  const { document, text } = await controlsFor(world, world.viewer.email);
  expect(document.querySelector('form[data-command]')).toBeNull();
  expect(document.body.textContent).toContain('View only');
  expect(document.body.textContent).toContain('Only admins of 80-89 can change this.');
  const pickups = [...document.querySelectorAll('select[name$=".agentPickup"]')];
  expect(pickups.length).toBeGreaterThan(3);
  expect(pickups.every((select) => select.hasAttribute('disabled'))).toBe(true);
  const shadow = document.querySelector('[data-switch="shadow"]');
  expect(shadow?.getAttribute('aria-pressed')).toBe('false');
  expect(shadow?.hasAttribute('disabled')).toBe(true);
  expect(await screenProblems(text)).toEqual([]);
}

async function showsSwitchState(world: BoardWorld): Promise<void> {
  const kernel = kernelOn(world.db, viewClock);
  await kernel.stages.setShadow(callerOf(world.rowan), {
    harnessId: world.harnessId,
    shadow: true,
  });
  const { document } = await controlsFor(world, world.viewer.email);
  expect(document.querySelector('[data-switch="shadow"]')?.getAttribute('aria-pressed')).toBe(
    'true',
  );
  const admin = await controlsFor(world, world.rowanEmail);
  const form = admin.document.querySelector('form[data-command="set_shadow"]');
  expect(form?.querySelector('input[name="shadow"]')?.getAttribute('value')).toBe('false');
}

async function warnsOfAnOpenDraft(world: BoardWorld): Promise<void> {
  const kernel = kernelOn(world.db, viewClock);
  await kernel.drafts.open(callerOf(world.rowan), { harnessId: world.harnessId });
  const { document } = await controlsFor(world, world.rowanEmail);
  expect(document.body.textContent).toContain('A draft of this workflow is open in Flow');
}

async function tabsLinkTheTab(world: BoardWorld): Promise<void> {
  const own = await controlsFor(world, world.rowanEmail);
  const current = own.document.querySelector('[aria-current="page"]');
  expect(current?.textContent).toContain('Stages & Controls');
  const flow = await getHtml(world.db, world.rowanEmail, flowPath(world.harnessId), {}, viewClock);
  const links = [...new JSDOM(flow.text).window.document.querySelectorAll('a')].map((link) =>
    link.getAttribute('href'),
  );
  expect(links).toContain(controlsPath(world.harnessId));
}

describe.skipIf(!testServer)('#108 the Stages & Controls tab', () => {
  it('gives an area admin the rule table, the pause buttons and the three switches', () =>
    inWorld(adminEdits));

  it('shows a team member the same values read-only, with the area that can change them', () =>
    inWorld(memberSeesViewOnly));

  it('shows each switch as it is, and offers the admin the opposite', () =>
    inWorld(showsSwitchState));

  it('says when a draft is open, since saving waits for it', () => inWorld(warnsOfAnOpenDraft));

  it('is a tab of every workflow page', () => inWorld(tabsLinkTheTab));
});

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { fakeBrowser } from '../testing/browser.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { teamWorld, type TeamWorld } from '../testing/team.ts';
import { getHtml, getWithBindings } from '../testing/views.ts';
import { chartFilePath, teamChartsPath } from './parts/paths.ts';

const clock: Clock = { now: () => new Date('2026-11-26T12:00:00.000Z') };

async function inWorld(work: (world: TeamWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await teamWorld(db)));
}

async function screenOf(world: TeamWorld, email: string, query = '') {
  const page = await getHtml(world.db, email, `${teamChartsPath()}${query}`, {}, clock);
  return { page, document: new JSDOM(page.text).window.document };
}

function commitmentEditor(document: Document) {
  const add = document.querySelector('form[data-command="add_commitment"]');
  const from = add?.querySelector<HTMLInputElement>('input[name="fromPersonId"]')?.value;
  const removals = [...document.querySelectorAll('form[data-command="remove_commitment"]')];
  const removing = removals.map((form) => form.textContent?.replace('Remove', '').trim());
  const chooser = document.querySelector('form[method="get"] select[name="person"]');
  return { from, removing, chooser, open: add?.closest('details')?.hasAttribute('open') };
}

function texts(document: Document, selector: string): (string | null)[] {
  return [...document.querySelectorAll(selector)].map((node) => node.textContent);
}

async function rendersCleanly(world: TeamWorld): Promise<void> {
  for (const email of [world.reader.email, world.steward.email, world.lee.email]) {
    const { page } = await screenOf(world, email);
    expect(page.status).toBe(200);
    expect(await screenProblems(page.text)).toEqual([]);
  }
}

async function drawsThreeChartsWithTheirData(world: TeamWorld): Promise<void> {
  const { document } = await screenOf(world, world.reader.email);
  expect(document.querySelector('main [data-shape="overview"] h1')?.textContent).toBe(
    'Team Charts',
  );
  expect(texts(document, 'main section[aria-labelledby$="-chart-heading"] h2')).toEqual([
    'Commitments network',
    'Staff allocation',
    'People and portfolios',
  ]);
  expect(document.querySelectorAll('main svg[role="img"]')).toHaveLength(3);
  const notes = texts(document, 'main [role="note"]').join('\n');
  expect(notes).toContain(
    'Left out, ambiguous: Lee-Anne Placeholder named “Sam”, who could be Sam Sample or Sam Specimen.',
  );
  const rows = document.querySelectorAll(
    'section[aria-labelledby="commitments-rows-heading"] tbody tr',
  );
  expect(rows).toHaveLength(3);
  const links = [...document.querySelectorAll('main a[href^="/api/charts/"]')].map((a) =>
    a.getAttribute('href'),
  );
  expect(links).toContain(chartFilePath('commitments_network', null, 'png'));
  expect(links).toContain(chartFilePath('staff_allocation', null, 'csv'));
  const sidebar = texts(document, 'nav a').join('|');
  expect(sidebar).toContain('Team Charts');
}

async function editingIsAskedFor(world: TeamWorld): Promise<void> {
  const lee = await screenOf(world, world.lee.email);
  const own = lee.document.querySelector('form[data-command="add_commitment"]');
  expect(own?.closest('details')?.hasAttribute('open')).toBe(false);
  expect(lee.document.querySelector('form[data-command="set_staff_allocation"]')).toBeNull();
  const steward = await screenOf(world, world.steward.email);
  const allocation = steward.document.querySelector('form[data-command="set_staff_allocation"]');
  expect(allocation?.closest('details')?.hasAttribute('open')).toBe(false);
}

async function stewardChoosesWhoseCommitments(world: TeamWorld): Promise<void> {
  const own = commitmentEditor((await screenOf(world, world.steward.email)).document);
  expect(own.from).toBe(world.steward.id);
  expect(own.chooser).not.toBeNull();
  const query = `?person=${world.ada.id}`;
  const chosen = commitmentEditor((await screenOf(world, world.steward.email, query)).document);
  expect(chosen.from).toBe(world.ada.id);
  expect(chosen.removing.sort()).toEqual([
    'Committed to Sam Sample',
    'Committed to “lee.anne placeholder”',
  ]);
  expect(chosen.open).toBe(true);
}

async function colleagueEditsOnlyTheirOwn(world: TeamWorld): Promise<void> {
  const query = `?person=${world.ada.id}`;
  const lee = commitmentEditor((await screenOf(world, world.lee.email, query)).document);
  expect(lee.from).toBe(world.lee.id);
  expect(lee.removing).toEqual(['Committed to “Sam”']);
  expect(lee.chooser).toBeNull();
}

async function printsAsPdf(world: TeamWorld): Promise<void> {
  const browser = fakeBrowser();
  const path = `${teamChartsPath()}?format=pdf`;
  const sent = await getWithBindings(
    world.db,
    world.reader.email,
    path,
    { BROWSER: browser },
    clock,
  );
  expect(sent.status).toBe(200);
  expect(sent.headers.get('content-type')).toBe('application/pdf');
  const printed = new JSDOM(browser.calls()[0]?.html ?? '').window.document;
  expect(printed.querySelectorAll('svg[role="img"]')).toHaveLength(3);
  expect(printed.querySelector('form')).toBeNull();
}

async function outsiderGetsNotFound(world: TeamWorld): Promise<void> {
  const { page } = await screenOf(world, world.outsider.email);
  expect(page.status).toBe(404);
}

describe.skipIf(!testServer)('#200 the Team Charts screen', () => {
  it('#200 the screen renders under the screen check with no problems, for a reader, a steward and a colleague', () =>
    inWorld(rendersCleanly));
  it('#200 the screen draws the three charts with their data-quality notes, rows and downloads', () =>
    inWorld(drawsThreeChartsWithTheirData));
  it('#200 commitments and allocations are edited only when asked, and allocations only by a steward', () =>
    inWorld(editingIsAskedFor));
  it('#200 the directory steward chooses whose commitments to edit, and both add and remove act for that person', () =>
    inWorld(stewardChoosesWhoseCommitments));
  it('#200 a colleague edits only their own commitments, whoever the address names', () =>
    inWorld(colleagueEditsOnlyTheirOwn));
  it('#200 the screen prints as a PDF with its three charts and no forms', () =>
    inWorld(printsAsPdf));
  it('#200 a person who cannot read the directory gets not found', () =>
    inWorld(outsiderGetsNotFound));
});

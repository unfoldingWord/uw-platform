import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { collectionsAt, personWith, rowIn } from '../testing/collections.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';

const clock = { now: () => collectionsAt };
const view = (n: number) => `c0110000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type World = {
  readonly db: Database;
  readonly editor: string;
  readonly reader: string;
  readonly program: string;
};

function withWorld(work: (world: World) => Promise<void>) {
  return withAppDatabase(async (db) => {
    await ensureBuiltIns(db, collectionsAt);
    const editor = await personWith(db, 'editor', [
      { role: 'editor', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const reader = await personWith(db, 'reader', [
      { role: 'viewer', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const area = { jdArea: '60-69' };
    const portfolio = await rowIn(db, editor, {
      ...area,
      collection: 'portfolio',
      title: 'Bible translation',
    });
    const program = await rowIn(db, editor, {
      ...area,
      collection: 'program',
      title: 'Gateway languages',
      values: { portfolio, phase: 'active' },
    });
    await rowIn(db, editor, {
      ...area,
      collection: 'program',
      title: 'Oral Bible stories',
      values: { phase: 'idea' },
    });
    await rowIn(db, editor, {
      ...area,
      collection: 'project',
      title: 'Nairobi workshop',
      values: {
        program,
        phase: 'underway',
        training_event_id: 'EV-1',
        duration: { start: '2026-11-03', end: '2026-11-05' },
      },
    });
    await work({ db, editor: editor.email ?? '', reader: reader.email ?? '', program });
  });
}

async function page(world: World, email: string, path: string) {
  const html = await getHtml(world.db, email, path, {}, clock);
  expect(html.status, path).toBe(200);
  expect(await screenProblems(html.text), path).toEqual([]);
  return new JSDOM(html.text).window.document;
}

async function provesLayouts(world: World) {
  const board = await page(world, world.editor, `/collections/program/views/${view(401)}`);
  const columns = [...board.querySelectorAll('[data-board] [data-group]')].map((c) =>
    c.getAttribute('data-group'),
  );
  expect(columns).toEqual(['idea', 'planning', 'pilot', 'active', 'sunsetting', 'closed']);
  expect(board.querySelector('[data-group="active"] [data-card]')?.textContent).toContain(
    'Gateway languages',
  );
  expect(board.querySelectorAll('form[data-command="move_card"]')).toHaveLength(2);
  const table = await page(world, world.editor, `/collections/program/views/${view(403)}`);
  expect(table.querySelector('main table caption')?.textContent).toBe('Program Portfolio');
  expect(table.querySelectorAll('form[data-command="set_property"]').length).toBeGreaterThan(0);
  expect(table.body.textContent).toContain('Not connected yet');
  const chart = await page(world, world.editor, `/collections/program/views/${view(404)}`);
  expect(chart.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain(
    'Programs by phase',
  );
  expect(
    [...chart.querySelectorAll('main tbody td:first-child')].map((td) => td.textContent),
  ).toEqual(['To do', 'In progress', 'Complete']);
  const calendar = await page(
    world,
    world.editor,
    `/collections/project/views/${view(505)}?month=2026-11`,
  );
  const days = [...calendar.querySelectorAll('ol li')].filter((li) =>
    li.textContent?.includes('Nairobi workshop'),
  );
  expect(days).toHaveLength(3);
}

async function provesReaders(world: World) {
  const board = await page(world, world.reader, `/collections/program/views/${view(401)}`);
  expect(board.querySelectorAll('form[data-command="move_card"]')).toHaveLength(0);
  expect(board.querySelector('[draggable="true"]')).toBeNull();
  const table = await page(world, world.reader, `/collections/program/views/${view(403)}`);
  expect(table.querySelectorAll('form[data-command="set_property"]')).toHaveLength(0);
  const gallery = await page(world, world.reader, `/collections/project/views/${view(510)}`);
  expect(gallery.querySelector('main article h3')?.textContent).toBe('Nairobi workshop');
  const list = await page(world, world.reader, `/collections/project/views/${view(511)}`);
  expect(list.querySelector('main ul li')?.textContent).toContain('Underway');
}

async function provesRowPage(world: World) {
  const row = await page(world, world.editor, `/collections/program/rows/${world.program}`);
  const sections = [...row.querySelectorAll('main section h2')].map((h) => h.textContent);
  expect(sections).toEqual(['Overview', 'Details', 'Properties', 'Budget', 'Linked from', 'Page']);
  expect(row.body.textContent).not.toContain('Stakeholders');
  expect(row.body.textContent).toContain('Nairobi workshop');
  expect(row.querySelector('a[href^="/pages/"][href$="/edit"]')).not.toBeNull();
}

async function provesDirectoryWithholding(world: World) {
  const chart = await page(world, world.reader, `/collections/directory/views/${view(205)}`);
  expect(chart.querySelector('main')?.textContent).toContain(
    'cannot be shown to you: property not readable',
  );
  const table = await page(world, world.reader, `/collections/directory/views/${view(203)}`);
  expect(table.body.textContent).not.toContain('Phone');
}

describe.skipIf(!testServer)('#206 every layout renders', () => {
  it('draws a board, a table, a chart with its figures and a calendar on the right days', () =>
    withWorld(provesLayouts));
  it('gives a reader the gallery and list and no drag, move or edit control', () =>
    withWorld(provesReaders));
});

describe.skipIf(!testServer)('#206 the row page', () => {
  it('shows property sections, hides an empty property, lists related rows and links to the body', () =>
    withWorld(provesRowPage));
  it('refuses a directory chart in place and withholds private columns from a colleague', () =>
    withWorld(provesDirectoryWithholding));
});

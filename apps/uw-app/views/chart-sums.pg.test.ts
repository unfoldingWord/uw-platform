import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { collectionDefinitionSchema, viewSettingsSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { saveView } from '../collections/view-commands.ts';
import {
  accepted,
  collectionsAt,
  defined,
  personWith,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml } from '../testing/views.ts';

const clock = { now: () => collectionsAt };

const testBudget = collectionDefinitionSchema.parse({
  key: 'tbudget',
  name: 'Budget lines',
  jdArea: '60-69',
  rowSource: 'pages',
  pageType: 'entry',
  properties: [
    {
      key: 'name',
      name: 'Name',
      config: { type: 'title' },
      source: { kind: 'column', column: 'title' },
    },
    {
      key: 'phase',
      name: 'Phase',
      source: { kind: 'frontmatter' },
      config: {
        type: 'status',
        options: [
          { id: 'idea', name: 'Idea', group: 'to_do' },
          { id: 'running', name: 'Running', group: 'in_progress' },
          { id: 'closed', name: 'Closed', group: 'complete' },
        ],
      },
    },
    { key: 'amount', name: 'Amount', source: { kind: 'frontmatter' }, config: { type: 'number' } },
    {
      key: 'secret',
      name: 'Secret',
      source: { kind: 'frontmatter' },
      config: { type: 'number' },
      classification: 'restricted',
      rule: { steward: '20-29', role: 'viewer', owner: false },
    },
  ],
});

type World = { readonly db: Database; readonly admin: Principal; readonly editor: Principal };

function withWorld(work: (world: World) => Promise<void>) {
  return withAppDatabase(async (db) => {
    const admin = await personWith(db, 'ana', [
      { role: 'admin', area: '60-69' },
      { role: 'viewer', area: '20-29' },
      { role: 'viewer', area: '00-09' },
    ]);
    const editor = await personWith(db, 'ed', [
      { role: 'editor', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    await defined(db, admin, testBudget);
    for (let n = 0; n < 205; n += 1) {
      const values = { phase: n < 200 ? 'idea' : 'running', amount: 2, secret: 1 };
      await rowIn(db, admin, {
        collection: 'tbudget',
        jdArea: '60-69',
        title: `Line ${n}`,
        values,
      });
    }
    await work({ db, admin, editor });
  });
}

async function chartOf(world: World, sum: string): Promise<string> {
  const viewId = randomUUID();
  const settings = viewSettingsSchema.parse({
    name: 'By phase',
    layout: 'chart',
    scope: 'shared',
    group: { property: 'phase', by: 'value' },
    chart: { kind: 'bar', sum },
  });
  const command = {
    command: 'save_view',
    requestId: randomUUID(),
    collection: 'tbudget',
    viewId,
    settings,
  } as const;
  accepted(await saveView(world.db, command, requestOf(world.admin)));
  return `/collections/tbudget/views/${viewId}`;
}

async function figures(world: World, path: string, who: Principal) {
  const page = await getHtml(world.db, who.email ?? '', path, {}, clock);
  expect(page.status).toBe(200);
  const document = new JSDOM(page.text).window.document;
  const table = [...document.querySelectorAll('table')].find((t) =>
    (t.querySelector('caption')?.textContent ?? '').includes('figures'),
  );
  const header = table?.querySelectorAll('thead th')[1]?.textContent ?? '';
  const rows = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  );
  return { header, rows, text: document.body.textContent ?? '' };
}

async function provesExactSums(world: World) {
  const shown = await figures(world, await chartOf(world, 'amount'), world.editor);
  expect(shown.header).toBe('Sum of Amount');
  expect(shown.rows).toEqual([
    ['Idea', '400'],
    ['Running', '10'],
    ['Closed', '0'],
  ]);
}

async function provesWithheldSums(world: World) {
  const path = await chartOf(world, 'secret');
  const editor = await figures(world, path, world.editor);
  expect(editor.header).toBe('Count');
  expect(editor.rows).toEqual([
    ['Idea', '200'],
    ['Running', '5'],
    ['Closed', '0'],
  ]);
  expect(editor.text).toContain('You cannot read Secret on every row, so this chart shows counts.');
  const admin = await figures(world, path, world.admin);
  expect(admin.header).toBe('Sum of Secret');
  expect(admin.rows).toEqual([
    ['Idea', '200'],
    ['Running', '5'],
    ['Closed', '0'],
  ]);
}

describe.skipIf(!testServer)('a chart that sums a property', () => {
  it('adds up every row in each group, not only the rows loaded', () => withWorld(provesExactSums));
  it('shows counts with a note when the reader cannot read the property on every row', () =>
    withWorld(provesWithheldSums));
});

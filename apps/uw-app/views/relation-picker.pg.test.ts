import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { collectionsAt, personWith, rowIn } from '../testing/collections.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { PICKER_PAGE } from './parts/relation-picker.tsx';

const clock = { now: () => collectionsAt };

type World = { readonly db: Database; readonly editor: string; readonly program: string };

const titleOf = (n: number) => `Portfolio ${String(n).padStart(2, '0')}`;

function withWorld(work: (world: World) => Promise<void>) {
  return withAppDatabase(async (db) => {
    await ensureBuiltIns(db, collectionsAt);
    const editor = await personWith(db, 'editor', [
      { role: 'editor', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const ids: string[] = [];
    for (let n = 0; n < 60; n += 1) {
      const row = { collection: 'portfolio', jdArea: '60-69', title: titleOf(n) };
      ids.push(await rowIn(db, editor, row));
    }
    const program = await rowIn(db, editor, {
      collection: 'program',
      jdArea: '60-69',
      title: 'Gateway languages',
      values: { portfolio: ids[57] ?? '' },
    });
    await work({ db, editor: editor.email ?? '', program });
  });
}

async function picker(world: World, query: string) {
  const path = `/collections/program/rows/${world.program}${query}`;
  const page = await getHtml(world.db, world.editor, path, {}, clock);
  expect(page.status).toBe(200);
  const document = new JSDOM(page.text).window.document;
  const details = document.getElementById('portfolio');
  const options = [...(details?.querySelectorAll('select option') ?? [])]
    .map((option) => option.textContent ?? '')
    .filter((label) => label !== 'None');
  const more = details?.querySelector('a[href*="after="]')?.getAttribute('href') ?? null;
  return { page, details, options, more };
}

async function provesPaging(world: World) {
  const first = await picker(world, '');
  expect(first.options).toHaveLength(PICKER_PAGE + 1);
  expect(first.options).toContain(titleOf(57));
  expect(first.options.slice(0, 3)).toEqual([titleOf(0), titleOf(1), titleOf(2)]);
  expect(first.more).not.toBeNull();
  const second = await picker(world, (first.more ?? '').replace(/^[^?]*/, '').replace(/#.*$/, ''));
  expect(second.details?.hasAttribute('open')).toBe(true);
  expect(second.options).toEqual(Array.from({ length: 10 }, (_, i) => titleOf(PICKER_PAGE + i)));
  expect(second.more).toBeNull();
  expect(await screenProblems(first.page.text)).toEqual([]);
}

async function provesSearch(world: World) {
  const found = await picker(world, '?find=portfolio&q=Portfolio+4');
  expect(found.options).toEqual([
    ...Array.from({ length: 10 }, (_, i) => titleOf(40 + i)),
    titleOf(57),
  ]);
  expect(found.details?.querySelector('input[name="q"]')?.getAttribute('value')).toBe(
    'Portfolio 4',
  );
}

describe.skipIf(!testServer)('the relation picker on a row page', () => {
  it('pages through targets fifty at a time and always keeps the linked row', () =>
    withWorld(provesPaging));
  it('finds targets by title and keeps the linked row among the choices', () =>
    withWorld(provesSearch));
});

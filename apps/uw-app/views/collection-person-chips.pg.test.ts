import { eq } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { people } from '@uw/db/schema';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { collectionsAt, personWith, rowIn } from '../testing/collections.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { collectionRowPath, personPath } from './parts/paths.ts';

const clock = { now: () => collectionsAt };
const board = '/collections/tasks/views/c0110000-0000-4000-8000-000000000102';
const table = '/collections/tasks/views/c0110000-0000-4000-8000-000000000103';

type World = {
  readonly db: Database;
  readonly reader: Principal;
  readonly blair: Principal;
  readonly gone: Principal;
  readonly task: string;
};

function idOf(person: Principal): string {
  return person.personId ?? '';
}

function nameOf(person: Principal): string {
  return person.email ?? '';
}

async function world(db: Database): Promise<World> {
  await ensureBuiltIns(db, collectionsAt);
  const reading = { role: 'viewer', area: '00-09' } as const;
  const infrastructure = { role: 'editor', area: '30-39' } as const;
  const reader = await personWith(db, 'casey.vale', [reading, infrastructure]);
  const blair = await personWith(db, 'blair.reed', [reading, infrastructure]);
  const gone = await personWith(db, 'gone.mate', [reading, infrastructure]);
  const task = await rowIn(db, blair, {
    collection: 'tasks',
    jdArea: '30-39',
    title: 'Renew the certificates',
    values: { status: 'in_progress', assignees: [idOf(blair), idOf(gone)] },
  });
  await db
    .update(people)
    .set({ status: 'disabled' })
    .where(eq(people.id, idOf(gone)));
  return { db, reader, blair, gone, task };
}

async function open(w: World, path: string): Promise<Document> {
  const page = await getHtml(w.db, nameOf(w.reader), path, {}, clock);
  expect(page.status, path).toBe(200);
  expect(await screenProblems(page.text), path).toEqual([]);
  return new JSDOM(page.text).window.document;
}

function chipsIn(document: Document): readonly Element[] {
  return [...document.querySelectorAll('main [data-person-chip]')];
}

function chipNamed(document: Document, name: string): Element | undefined {
  return chipsIn(document).find((chip) => (chip.textContent ?? '').includes(name));
}

function provesChips(w: World, document: Document): void {
  const blair = chipNamed(document, nameOf(w.blair));
  expect(blair?.tagName).toBe('A');
  expect(blair?.getAttribute('href')).toBe(personPath(idOf(w.blair)));
  const gone = chipNamed(document, nameOf(w.gone));
  expect(gone?.tagName).toBe('SPAN');
  expect(gone?.getAttribute('href')).toBeNull();
}

function run(work: (w: World) => Promise<void>) {
  return withAppDatabase(async (db) => work(await world(db)));
}

describe.skipIf(!testServer)('#208 a person property shows as a person chip', () => {
  it('shows assignees as chips in a table layout, linked only where the profile opens', () =>
    run(async (w) => {
      provesChips(w, await open(w, table));
    }));

  it('shows assignees as chips on board cards', () =>
    run(async (w) => {
      provesChips(w, await open(w, board));
    }));

  it('shows assignees as chips on the row page', () =>
    run(async (w) => {
      provesChips(w, await open(w, collectionRowPath('tasks', w.task)));
    }));
});

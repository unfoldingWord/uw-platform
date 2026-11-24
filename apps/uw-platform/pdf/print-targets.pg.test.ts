import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage } from '@uw/db/test-seed';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { pageVersion } from '../pages/history.ts';
import { collectionsAt, personWith } from '../testing/collections.ts';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { pageVersionHash } from './provenance.ts';
import { binderPlan, printBinder, printPage, printView, type Printable } from './print-targets.ts';

const COMMIT = 'test-commit';
const programTable = 'c0110000-0000-4000-8000-000000000403';

type Tree = {
  readonly editor: Principal;
  readonly reader: Principal;
  readonly root: string;
  readonly hidden: string;
};

async function bothAreas(db: Database) {
  const made = await person(db, 'binder-editor', 'editor', '00-09');
  await seedGrant(db, {
    id: randomUUID(),
    personId: made.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '30-39',
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  return made;
}

async function filed(
  db: Database,
  email: string,
  category: string,
  fields: Readonly<Record<string, unknown>>,
) {
  const made = await fileKnowledge(db, email, category, fields);
  expect(made.sent.body).toMatchObject({ status: 'accepted' });
  return made.pageId;
}

async function tree(db: Database): Promise<Tree> {
  const editor = await bothAreas(db);
  const reader = await person(db, 'binder-reader', 'viewer', '00-09');
  const root = await filed(db, editor.email, '01', { title: 'Handbook', bodyMd: 'Root body.' });
  const under = (parentId: string, title: string, category = '01') =>
    filed(db, editor.email, category, { title, parentId, bodyMd: `${title} body.` });
  const alpha = await under(root, 'Alpha');
  await under(root, 'Beta');
  await under(alpha, 'Alpha one');
  const hidden = await under(root, 'Aardvark', '31');
  const at = new Date();
  return {
    editor: await personOn(db, editor.id, editor.email, at),
    reader: await personOn(db, reader.id, reader.email, at),
    root,
    hidden,
  };
}

function titlesIn(html: string): readonly string[] {
  return [...html.matchAll(/<section data-pdf-section="" id="part-\d+"><h1>([^<]*)<\/h1>/g)].map(
    (match) => match[1] ?? '',
  );
}

async function printed(db: Database, actor: Principal, rootPageId: string): Promise<Printable> {
  const request = { kind: 'binder', rootPageId } as const;
  const found = await printBinder(db, actor, request, new Date(), COMMIT);
  if (found === null) throw new Error('nothing printed');
  return found;
}

async function ordersDepthFirstAndSkipsUnreadable(db: Database): Promise<void> {
  const made = await tree(db);
  const read = await printed(db, made.reader, made.root);
  expect(titlesIn(read.bodyHtml)).toEqual(['Handbook', 'Alpha', 'Alpha one', 'Beta']);
  expect(read.title).toBe('Handbook');
  expect(read.areas).toEqual(['00-09']);
  expect(read.bodyHtml).toContain('Alpha one body.');
  expect(read.bodyHtml).not.toContain('Aardvark');
  const full = await printed(db, made.editor, made.root);
  expect(titlesIn(full.bodyHtml)).toEqual(['Handbook', 'Aardvark', 'Alpha', 'Alpha one', 'Beta']);
  expect([...full.areas].sort()).toEqual(['00-09', '30-39']);
  expect(full.printed.filters).toHaveLength(5);
  expect(full.printed.hashInput.kind).toBe('hash');
}

async function listedBinderKeepsTheGivenOrder(db: Database): Promise<void> {
  const made = await tree(db);
  const at = new Date();
  const request = {
    kind: 'binder' as const,
    title: 'Two pages',
    pageIds: [made.hidden, made.root, randomUUID()],
  };
  const read = await printBinder(db, made.editor, request, at, COMMIT);
  expect(titlesIn(read?.bodyHtml ?? '')).toEqual(['Aardvark', 'Handbook']);
  expect(read?.title).toBe('Two pages');
  expect(await binderPlan(db, made.reader, { ...request, pageIds: [made.hidden] }, at)).toBe(
    'binder_empty',
  );
}

async function refusesABinderOverFifty(db: Database): Promise<void> {
  const made = await tree(db);
  for (let at = 0; at < 50; at += 1) {
    const id = randomUUID();
    const slug = `many-${id.slice(0, 8)}`;
    const title = `Many ${String(at).padStart(2, '0')}`;
    const placed = { jdArea: '00-09', slug, title, bodyMd: '', parentId: made.root };
    await seedPage(db, { id, type: 'knowledge', status: 'active', ...placed });
  }
  const request = { kind: 'binder', rootPageId: made.root } as const;
  expect(await binderPlan(db, made.reader, request, new Date())).toBe('binder_too_large');
  expect(await printBinder(db, made.reader, request, new Date(), COMMIT)).toBeNull();
}

async function printsAPageAtItsVersion(db: Database): Promise<void> {
  const made = await tree(db);
  const at = new Date();
  const printed = await printPage(db, made.reader, made.root, at, COMMIT);
  const snapshot = await pageVersion(db, made.reader, { pageId: made.root, version: 1 }, at);
  const page = snapshot?.page;
  if (page === undefined) throw new Error('no version');
  expect(printed?.title).toBe('Handbook');
  expect(printed?.bodyHtml).toContain('Root body.');
  expect(printed?.areas).toEqual(['00-09']);
  expect(printed?.printed).toEqual({
    reference: `00-09/${page.slug}@v1`,
    filters: [],
    hashInput: { kind: 'hash', sha256: await pageVersionHash({ ...page, pageId: page.id }) },
  });
  expect(await printPage(db, made.reader, made.hidden, at, COMMIT)).toBeNull();
}

async function printsASavedView(db: Database): Promise<void> {
  await ensureBuiltIns(db, collectionsAt);
  const reader = await personWith(db, 'view-reader', [
    { role: 'viewer', area: '60-69' },
    { role: 'viewer', area: '00-09' },
  ]);
  const stranger = await personWith(db, 'view-stranger', [{ role: 'viewer', area: '30-39' }]);
  const printed = await printView(db, reader, 'program', programTable, collectionsAt);
  expect(printed?.printed.reference).toMatch(/^program\//);
  expect(printed?.printed.hashInput.kind).toBe('hash');
  expect(printed?.areas.length).toBe(1);
  expect(printed?.bodyHtml).toContain('<table');
  expect(await printView(db, stranger, 'program', programTable, collectionsAt)).toBeNull();
  expect(await printView(db, reader, 'program', randomUUID(), collectionsAt)).toBeNull();
}

describe.skipIf(!testServer)('#198 what a PDF export prints, without a request', () => {
  it('#198 prints a binder by root page depth-first and leaves out pages the reader cannot read', () =>
    withAppDatabase(ordersDepthFirstAndSkipsUnreadable));
  it('#198 prints a listed binder in the given order and refuses one with nothing readable', () =>
    withAppDatabase(listedBinderKeepsTheGivenOrder));
  it('#198 refuses binder_too_large for a root page with more than fifty pages under it', () =>
    withAppDatabase(refusesABinderOverFifty));
  it('#198 prints a page with its versioned reference and its page version hash', () =>
    withAppDatabase(printsAPageAtItsVersion));
  it('#198 prints a saved view the reader may read, and nothing for a stranger', () =>
    withAppDatabase(printsASavedView));
});

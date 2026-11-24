import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { pages, pageVersions } from '@uw/db/schema';
import { setProperty } from '../collections/rows.ts';
import { post, person } from '../testing/commands.ts';
import { fakeBrowser } from '../testing/browser.ts';
import {
  accepted,
  collectionsAt,
  defined,
  personWith,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { testPortfolio } from '../testing/collection-definitions.ts';
import { personOn } from '../testing/kernel.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getWithBindings, type Fetched } from '../testing/views.ts';
import { pageVersionHash } from './provenance.ts';
import { printPage, type Printable } from './print-targets.ts';

const COMMIT = 'test-commit';
const SOURCE_HEADER = 'x-uw-source-sha256';
const SHOWN_ONLY = 'Source SHA-256 covers the fields shown to the exporter';
const clock = { now: () => collectionsAt };

async function snapshotHash(db: Database, pageId: string, version?: number): Promise<string> {
  const [current] = await db
    .select({ version: pages.version })
    .from(pages)
    .where(eq(pages.id, pageId));
  const wanted = version ?? current?.version ?? 0;
  const [row] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.version, wanted)));
  if (row === undefined) throw new Error(`no version ${String(wanted)}`);
  return pageVersionHash(row);
}

function hashOf(printable: Printable | null): { sourceSha256?: string; withheld?: boolean } {
  const input = printable?.printed.hashInput;
  if (input?.kind !== 'hash') throw new Error('not a source hash');
  return input;
}

function provenanceText(sent: Fetched, browser: ReturnType<typeof fakeBrowser>): string {
  expect(sent.status).toBe(200);
  const [call] = browser.calls();
  const html = call?.html ?? '';
  return new JSDOM(html).window.document.querySelector('[data-pdf-provenance]')?.textContent ?? '';
}

async function screenPdf(db: Database, email: string, path: string) {
  const browser = fakeBrowser();
  const sent = await getWithBindings(db, email, path, { BROWSER: browser }, clock);
  return { sent, provenance: provenanceText(sent, browser) };
}

async function editedTwice(db: Database) {
  const editor = await person(db, 'pin-editor', 'editor', '00-09');
  const filed = await fileKnowledge(db, editor.email, '01', {
    title: 'Pinned policy',
    slug: 'pinned-policy',
    bodyMd: 'First words.',
  });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  const sent = await post(db, editor.email, '/api/pages/commands/update_page', {
    command: 'update_page',
    requestId: randomUUID(),
    pageId: filed.pageId,
    expectedVersion: 1,
    slug: 'pinned-policy',
    title: 'Pinned policy',
    parentId: null,
    frontmatter: { jd_category: '01' },
    bodyMd: 'Second words.',
    status: 'active',
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
  const actor = await personOn(db, editor.id, editor.email, collectionsAt);
  return { email: editor.email, actor, pageId: filed.pageId };
}

async function pinsTheScreenAndVerbPaths(db: Database): Promise<void> {
  const made = await editedTwice(db);
  const verb = hashOf(await printPage(db, made.actor, made.pageId, collectionsAt, COMMIT));
  expect(verb.sourceSha256).toBe(await snapshotHash(db, made.pageId, 2));
  const current = await screenPdf(db, made.email, `/pages/${made.pageId}?format=pdf`);
  expect(current.sent.headers.get(SOURCE_HEADER)).toBe(verb.sourceSha256);
  const path = `/pages/${made.pageId}/versions/1?format=pdf`;
  const old = await screenPdf(db, made.email, path);
  expect(old.sent.headers.get(SOURCE_HEADER)).toBe(await snapshotHash(db, made.pageId, 1));
  expect(current.provenance).not.toContain(SHOWN_ONLY);
}

type Costed = { readonly blind: Principal; readonly finance: Principal; readonly row: string };

async function costedRow(db: Database): Promise<Costed> {
  const admin = await personWith(db, 'src-admin', [{ role: 'admin', area: '60-69' }]);
  const blind = await personWith(db, 'src-blind', [{ role: 'editor', area: '60-69' }]);
  const finance = await personWith(db, 'src-finance', [
    { role: 'editor', area: '60-69' },
    { role: 'viewer', area: '20-29' },
  ]);
  await defined(db, admin, testPortfolio);
  const row = await rowIn(db, blind, { collection: 'tportfolio', jdArea: '60-69', title: 'Bible' });
  const cost = {
    command: 'set_property',
    requestId: randomUUID(),
    collection: 'tportfolio',
    rowId: row,
    property: 'cost',
    value: 1200,
  } as const;
  accepted(await setProperty(db, cost, requestOf(finance)));
  return { blind, finance, row };
}

async function namesWhatTheHashCovers(db: Database): Promise<void> {
  const made = await costedRow(db);
  const full = await snapshotHash(db, made.row);
  const seeing = hashOf(await printPage(db, made.finance, made.row, collectionsAt, COMMIT));
  expect(seeing).toMatchObject({ sourceSha256: full, withheld: false });
  const blind = hashOf(await printPage(db, made.blind, made.row, collectionsAt, COMMIT));
  expect(blind.withheld).toBe(true);
  expect(blind.sourceSha256).not.toBe(full);
  const path = `/pages/${made.row}?format=pdf`;
  const shown = await screenPdf(db, made.blind.email ?? '', path);
  expect(shown.sent.headers.get(SOURCE_HEADER)).toBe(blind.sourceSha256);
  expect(shown.provenance).toContain(SHOWN_ONLY);
  const whole = await screenPdf(db, made.finance.email ?? '', path);
  expect(whole.sent.headers.get(SOURCE_HEADER)).toBe(full);
  expect(whole.provenance).not.toContain(SHOWN_ONLY);
}

describe.skipIf(!testServer)('#198 the source hash of a printed page', () => {
  it('#198 is the same on the page screen and in render_pdf, and a version screen hashes its snapshot', () =>
    withAppDatabase(pinsTheScreenAndVerbPaths));
  it('#198 covers only the fields shown to the exporter, and the provenance says so when any are withheld', () =>
    withAppDatabase(namesWhatTheHashCovers));
});

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { collectionDefinitionSchema, viewSettingsSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { pageVersions } from '@uw/db/schema';
import { saveView } from '../collections/view-commands.ts';
import type { PdfQuickAction } from '../env.ts';
import { canonicalJson, pageVersionHash, sha256Hex } from '../pdf/provenance.ts';
import { post, person } from '../testing/commands.ts';
import { failingBrowser, fakeBrowser } from '../testing/browser.ts';
import {
  accepted,
  collectionsAt,
  defined,
  personWith,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml, getWithBindings, type Fetched } from '../testing/views.ts';

const SLUG = 'travel-policy';

type Pages = {
  readonly editor: string;
  readonly stranger: string;
  readonly pageId: string;
  readonly childId: string;
};

async function edited(db: Database, email: string, pageId: string, bodyMd: string) {
  const sent = await post(db, email, '/api/pages/commands/update_page', {
    command: 'update_page',
    requestId: randomUUID(),
    pageId,
    expectedVersion: 1,
    slug: SLUG,
    title: 'Travel policy',
    parentId: null,
    frontmatter: { jd_category: '01' },
    bodyMd,
    status: 'active',
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
}

async function pages(db: Database): Promise<Pages> {
  const editor = await person(db, 'pdf-editor', 'editor', '00-09');
  const stranger = await person(db, 'pdf-stranger', 'viewer', '80-89');
  const filed = await fileKnowledge(db, editor.email, '01', {
    title: 'Travel policy',
    slug: SLUG,
    bodyMd: 'First words.',
  });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  await edited(
    db,
    editor.email,
    filed.pageId,
    'Second words, see [the guide](https://example.org/guide).',
  );
  const child = await fileKnowledge(db, editor.email, '01', {
    title: 'Travel claims',
    parentId: filed.pageId,
  });
  expect(child.sent.body).toMatchObject({ status: 'accepted' });
  return {
    editor: editor.email,
    stranger: stranger.email,
    pageId: filed.pageId,
    childId: child.pageId,
  };
}

async function versionHash(db: Database, pageId: string, version: number): Promise<string> {
  const [row] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.version, version)));
  if (row === undefined) throw new Error(`no version ${String(version)}`);
  return pageVersionHash(row);
}

function onlyCall(calls: readonly PdfQuickAction[]): PdfQuickAction {
  expect(calls).toHaveLength(1);
  const [call] = calls;
  if (call === undefined) throw new Error('no call');
  return call;
}

function isPdf(sent: Fetched): void {
  expect(sent.status).toBe(200);
  expect(sent.headers.get('content-type')).toBe('application/pdf');
  expect(new TextDecoder().decode(sent.bytes.slice(0, 5))).toBe('%PDF-');
}

function reasonOf(sent: Fetched): unknown {
  return (JSON.parse(new TextDecoder().decode(sent.bytes)) as { reason?: unknown }).reason;
}

async function printsThePageVersionItShows(db: Database): Promise<void> {
  const made = await pages(db);
  const browser = fakeBrowser();
  const sent = await getWithBindings(db, made.editor, `/pages/${made.pageId}?format=pdf`, {
    BROWSER: browser,
  });
  isPdf(sent);
  const hash = await versionHash(db, made.pageId, 2);
  expect(hash).not.toBe(await versionHash(db, made.pageId, 1));
  expect(sent.headers.get('x-uw-sha256')).toBe(hash);
  const call = onlyCall(browser.calls());
  expect(call.pdfOptions.footerTemplate).toContain(`00-09/${SLUG}@v2`);
  expect(call.pdfOptions.footerTemplate).toContain(`sha256:${hash.slice(0, 12)}`);
  const printed = new JSDOM(call.html).window.document;
  expect(printed.querySelector('[data-pdf-provenance] [data-hash]')?.textContent).toBe(hash);
  expect(printed.querySelector('[data-pdf-provenance]')?.textContent).toContain(made.editor);
  expect(printed.querySelector('[data-page-body]')?.textContent).toContain('Second words');
  expect(printed.querySelector('[data-pdf-links]')?.textContent).toContain(
    'https://example.org/guide',
  );
  expect(printed.querySelector('[data-page-more]')).toBeNull();
}

async function printsAnOldVersionByItsNumber(db: Database): Promise<void> {
  const made = await pages(db);
  const browser = fakeBrowser();
  const path = `/pages/${made.pageId}/versions/1?format=pdf`;
  const sent = await getWithBindings(db, made.editor, path, { BROWSER: browser });
  isPdf(sent);
  const hash = await versionHash(db, made.pageId, 1);
  expect(sent.headers.get('x-uw-sha256')).toBe(hash);
  const call = onlyCall(browser.calls());
  expect(call.pdfOptions.footerTemplate).toContain(`00-09/${SLUG}@v1`);
  expect(call.html).toContain('First words.');
  expect(call.html).not.toContain('Second words');
}

async function refusesThePdfAsItRefusesTheScreen(db: Database): Promise<void> {
  const made = await pages(db);
  const browser = fakeBrowser();
  const screen = await getHtml(db, made.stranger, `/pages/${made.pageId}`);
  const pdf = await getWithBindings(db, made.stranger, `/pages/${made.pageId}?format=pdf`, {
    BROWSER: browser,
  });
  expect(screen.status).toBe(404);
  expect(pdf.status).toBe(404);
  expect(pdf.headers.get('content-type')).toBe(screen.headers.get('content-type'));
  expect(new TextDecoder().decode(pdf.bytes)).toContain('You cannot open that page');
  const version = `/pages/${made.pageId}/versions/1?format=pdf`;
  expect((await getWithBindings(db, made.stranger, version, { BROWSER: browser })).status).toBe(
    404,
  );
  expect(browser.calls()).toEqual([]);
}

async function refusesWithoutAWorkingBrowser(db: Database): Promise<void> {
  const made = await pages(db);
  const path = `/pages/${made.pageId}?format=pdf`;
  const unbound = await getWithBindings(db, made.editor, path, {});
  expect([unbound.status, reasonOf(unbound)]).toEqual([404, 'not_wired']);
  const failed = await getWithBindings(db, made.editor, path, { BROWSER: failingBrowser() });
  expect([failed.status, reasonOf(failed)]).toEqual([502, 'pdf_render_failed']);
}

function textOf(element: Element | null | undefined): string | undefined {
  return element?.textContent?.trim();
}

async function menuOf(db: Database, email: string, pageId: string): Promise<Element | null> {
  const page = await getHtml(db, email, `/pages/${pageId}`);
  return new JSDOM(page.text).window.document.querySelector('main details[data-page-more]');
}

function offersTheBinder(more: Element | null, pageId: string): void {
  const binder = more?.querySelector('form[method="post"][action="/api/exports"]');
  expect(binder?.querySelector('input[name="rootPageId"]')?.getAttribute('value')).toBe(pageId);
  expect(binder?.querySelector('input[name="kind"]')?.getAttribute('value')).toBe('binder');
  expect(textOf(binder?.querySelector('button[type="submit"]'))).toBe(
    'Export with subpages as PDF',
  );
}

async function offersTheExportsInTheMenu(db: Database): Promise<void> {
  const made = await pages(db);
  const more = await menuOf(db, made.editor, made.pageId);
  expect(textOf(more?.querySelector(`a[href="/pages/${made.pageId}?format=pdf"]`))).toBe(
    'Export as PDF',
  );
  expect(textOf(more?.querySelector('button[data-print]'))).toBe('Print');
  offersTheBinder(more, made.pageId);
  const child = await menuOf(db, made.editor, made.childId);
  expect(child?.querySelector(`a[href="/pages/${made.childId}?format=pdf"]`)).not.toBeNull();
  expect(child?.querySelector('form[action="/api/exports"]')).toBeNull();
}

const clock = { now: () => collectionsAt };

const budget = collectionDefinitionSchema.parse({
  key: 'tpdfbudget',
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
  ],
});

type Budget = { readonly db: Database; readonly admin: Principal; readonly running: string[] };

async function budgetWorld(db: Database): Promise<Budget> {
  const admin = await personWith(db, 'pdf-ana', [
    { role: 'admin', area: '60-69' },
    { role: 'viewer', area: '00-09' },
  ]);
  await defined(db, admin, budget);
  const running: string[] = [];
  for (const [n, phase] of ['idea', 'running', 'running', 'idea'].entries()) {
    const values = { phase, amount: n + 1 };
    const id = await rowIn(db, admin, {
      collection: 'tpdfbudget',
      jdArea: '60-69',
      title: `Line ${String(n)}`,
      values,
    });
    if (phase === 'running') running.unshift(id);
  }
  return { db, admin, running };
}

async function saved(world: Budget, settings: unknown): Promise<string> {
  const viewId = randomUUID();
  const command = {
    command: 'save_view',
    requestId: randomUUID(),
    collection: 'tpdfbudget',
    viewId,
    settings: viewSettingsSchema.parse(settings),
  } as const;
  accepted(await saveView(world.db, command, requestOf(world.admin)));
  return viewId;
}

const runningOnly = {
  name: 'Running lines',
  layout: 'table',
  scope: 'shared',
  filter: {
    kind: 'group',
    conjunction: 'and',
    children: [{ kind: 'condition', property: 'phase', operator: 'is', value: 'running' }],
  },
  sorts: [{ property: 'amount', direction: 'desc' }],
};

async function printsTheViewsFilters(db: Database): Promise<void> {
  const world = await budgetWorld(db);
  const viewId = await saved(world, runningOnly);
  const browser = fakeBrowser();
  const path = `/collections/tpdfbudget/views/${viewId}?format=pdf`;
  const sent = await getWithBindings(
    db,
    world.admin.email ?? '',
    path,
    { BROWSER: browser },
    clock,
  );
  isPdf(sent);
  const call = onlyCall(browser.calls());
  expect(call.pdfOptions.footerTemplate).toContain('tpdfbudget/Running lines');
  const provenance = new JSDOM(call.html).window.document.querySelector('[data-pdf-provenance]');
  expect(provenance?.textContent).toContain('Filter: Phase is "running"');
  expect(provenance?.textContent).toContain('Sort: Amount descending');
  const settings = viewSettingsSchema.parse(runningOnly);
  const params = { month: null, cursor: null };
  const expected = await sha256Hex(
    canonicalJson({ viewId, settings, params, rowIds: world.running }),
  );
  expect(sent.headers.get('x-uw-sha256')).toBe(expected);
}

async function printsAChartAsVectorArt(db: Database): Promise<void> {
  const world = await budgetWorld(db);
  const viewId = await saved(world, {
    name: 'By phase',
    layout: 'chart',
    scope: 'shared',
    group: { property: 'phase', by: 'value' },
    chart: { kind: 'bar', sum: null },
  });
  const browser = fakeBrowser();
  const path = `/collections/tpdfbudget/views/${viewId}?format=pdf`;
  isPdf(await getWithBindings(db, world.admin.email ?? '', path, { BROWSER: browser }, clock));
  const printed = new JSDOM(onlyCall(browser.calls()).html).window.document;
  expect(printed.querySelector('svg[role="img"]')).not.toBeNull();
  expect(printed.querySelector('form')).toBeNull();
}

async function offersThePdfBesideTheCsv(db: Database): Promise<void> {
  const world = await budgetWorld(db);
  const viewId = await saved(world, runningOnly);
  const page = await getHtml(
    db,
    world.admin.email ?? '',
    `/collections/tpdfbudget/views/${viewId}`,
    {},
    clock,
  );
  const document = new JSDOM(page.text).window.document;
  const link = document.querySelector(
    `main a[href="/collections/tpdfbudget/views/${viewId}?format=pdf"]`,
  );
  expect(link?.textContent?.trim()).toBe('Export as PDF');
  expect(
    document.querySelector(`main a[href="/api/collections/tpdfbudget/views/${viewId}/export"]`),
  ).not.toBeNull();
}

describe.skipIf(!testServer)('#198 a page prints as a PDF through ?format=pdf', () => {
  it('#198 prints the page as a PDF whose footer names area/slug@v2 and the version hash', () =>
    withAppDatabase(printsThePageVersionItShows));
  it('#198 prints an old version under its own number and hash', () =>
    withAppDatabase(printsAnOldVersionByItsNumber));
  it('#198 refuses a principal the PDF with the same 404 as the screen and renders nothing', () =>
    withAppDatabase(refusesThePdfAsItRefusesTheScreen));
  it('#198 refuses not_wired without a browser and pdf_render_failed when it fails', () =>
    withAppDatabase(refusesWithoutAWorkingBrowser));
  it('#198 offers Export as PDF, Print and, with subpages, a binder in the page menu', () =>
    withAppDatabase(offersTheExportsInTheMenu));
});

describe.skipIf(!testServer)('#198 a saved view prints as a PDF through ?format=pdf', () => {
  it('#198 names the view and its filters in the footer and hashes what was printed', () =>
    withAppDatabase(printsTheViewsFilters));
  it('#198 prints a chart view as its vector svg', () => withAppDatabase(printsAChartAsVectorArt));
  it('#198 offers Export as PDF beside the CSV export', () =>
    withAppDatabase(offersThePdfBesideTheCsv));
});

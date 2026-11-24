import { binderLimit, type BinderRequest, type Page } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { pageVersion } from '../pages/history.ts';
import { listPages } from '../pages/listing.ts';
import { renderPage } from '../pages/render-page.ts';
import { readPage } from '../pages/store.ts';
import { withViews } from '../views/parts/view-embed.tsx';
import { binderBody, type BinderSection } from './print-document.ts';
import { screenOf, titled, type Printable } from './print-kernel.ts';
import { canonicalJson, exporterOf, pageVersionHash, sha256Hex } from './provenance.ts';

export { printView } from './print-view.tsx';
export type { Printable } from './print-kernel.ts';

export type BinderRefusal = 'binder_empty' | 'binder_too_large';

export type BinderPlan = {
  readonly title: string;
  readonly pages: readonly Page[];
  readonly root: Page | null;
  readonly areas: readonly string[];
};

type Reader = { readonly db: Database; readonly actor: Principal; readonly at: Date };
type Section = BinderSection & { readonly sha256: string };

const DEEPEST = 20;
const CHILDREN = 200;

function pageReference(page: Page): string {
  return `${page.jdArea}/${page.slug}@v${page.version}`;
}

async function pageHash(reader: Reader, page: Page): Promise<string> {
  const key = { pageId: page.id, version: page.version };
  const snapshot = await pageVersion(reader.db, reader.actor, key, reader.at);
  const source = snapshot?.page ?? page;
  return pageVersionHash({ ...source, pageId: page.id });
}

async function pageHtml(reader: Reader, page: Page, commit: string): Promise<string> {
  const { db, actor, at } = reader;
  const rendered = await renderPage(db, actor, page, at, commit);
  return (await withViews(db, screenOf(db, actor, at), rendered)).html;
}

export async function printPage(
  db: Database,
  actor: Principal,
  pageId: string,
  at: Date,
  commit: string,
): Promise<Printable | null> {
  const reader = { db, actor, at };
  const page = await readPage(db, actor, pageId, at);
  if (page === null) return null;
  return {
    title: page.title,
    bodyHtml: titled(page.title, await pageHtml(reader, page, commit)),
    printed: {
      reference: pageReference(page),
      filters: [],
      hashInput: { kind: 'hash', sha256: await pageHash(reader, page) },
    },
    areas: [page.jdArea],
  };
}

async function readable(reader: Reader, ids: readonly string[]): Promise<readonly Page[]> {
  const found: Page[] = [];
  for (const id of new Set(ids)) {
    const page = await readPage(reader.db, reader.actor, id, reader.at);
    if (page !== null) found.push(page);
  }
  return found;
}

async function walk(reader: Reader, parent: string, depth: number, found: string[]) {
  if (depth > DEEPEST || found.length > binderLimit) return;
  const query = { parent, limit: CHILDREN };
  const listed = await listPages(reader.db, reader.actor, query, reader.at);
  for (const child of listed?.pages ?? []) {
    if (found.length > binderLimit) return;
    found.push(child.id);
    await walk(reader, child.id, depth + 1, found);
  }
}

function planOf(title: string, pages: readonly Page[], root: Page | null): BinderPlan {
  const areas = [...new Set(pages.map((page) => page.jdArea))];
  return { title, pages, root, areas };
}

async function rootPlan(
  reader: Reader,
  request: { readonly rootPageId: string; readonly title?: string | undefined },
): Promise<BinderPlan | BinderRefusal> {
  const root = await readPage(reader.db, reader.actor, request.rootPageId, reader.at);
  if (root === null) return 'binder_empty';
  const found = [root.id];
  await walk(reader, root.id, 1, found);
  if (found.length > binderLimit) return 'binder_too_large';
  return planOf(request.title ?? root.title, await readable(reader, found), root);
}

export async function binderPlan(
  db: Database,
  actor: Principal,
  request: BinderRequest,
  at: Date,
): Promise<BinderPlan | BinderRefusal> {
  const reader = { db, actor, at };
  if ('rootPageId' in request) return rootPlan(reader, request);
  const pages = await readable(reader, request.pageIds);
  return pages.length === 0 ? 'binder_empty' : planOf(request.title, pages, null);
}

async function sectionsOf(reader: Reader, plan: BinderPlan, commit: string): Promise<Section[]> {
  const sections: Section[] = [];
  for (const page of plan.pages) {
    sections.push({
      title: page.title,
      reference: pageReference(page),
      html: await pageHtml(reader, page, commit),
      sha256: await pageHash(reader, page),
    });
  }
  return sections;
}

export function binderReference(plan: BinderPlan): string {
  if (plan.root !== null) return `${pageReference(plan.root)} and the pages under it`;
  return `${plan.title} (${plan.pages.length} pages)`;
}

export async function printPlannedBinder(
  db: Database,
  actor: Principal,
  plan: BinderPlan,
  at: Date,
  commit: string,
): Promise<Printable> {
  const sections = await sectionsOf({ db, actor, at }, plan, commit);
  const cover = { title: plan.title, exportedBy: exporterOf(actor), exportedOn: formatDate(at) };
  const hashed = sections.map(({ reference, sha256 }) => ({ reference, sha256 }));
  return {
    title: plan.title,
    bodyHtml: binderBody(sections, cover),
    printed: {
      reference: binderReference(plan),
      filters: sections.map((section) => `page=${section.reference}`),
      hashInput: { kind: 'hash', sha256: await sha256Hex(canonicalJson(hashed)) },
    },
    areas: plan.areas,
  };
}

export async function printBinder(
  db: Database,
  actor: Principal,
  request: BinderRequest,
  at: Date,
  commit: string,
): Promise<Printable | null> {
  const plan = await binderPlan(db, actor, request, at);
  if (typeof plan === 'string') return null;
  return printPlannedBinder(db, actor, plan, at, commit);
}

import { binderLimit, type BinderRequest, type Page, type RenderChannel } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { listPages } from '../pages/listing.ts';
import { embedSources, embeddedPages, renderPageIn } from '../pages/render-page.ts';
import { readPage, readPageIn } from '../pages/store.ts';
import { withPanels } from '../views/parts/dashboard-panels.tsx';
import { withViews } from '../views/parts/view-embed.tsx';
import { binderBody, type BinderSection, type SourceHash } from './print-document.ts';
import { screenOf, titled, type Printable } from './print-kernel.ts';
import { pagePrinted, pageReference, pageSourceHash } from './page-source.ts';
import { canonicalJson, exporterOf, sha256Hex } from './provenance.ts';
import { storiesOnly } from '../stories/uses.ts';

export { printView } from './print-view.tsx';
export type { Printable } from './print-kernel.ts';

export type BinderRefusal = 'binder_empty' | 'binder_too_large';

export type BinderPlan = {
  readonly title: string;
  readonly pages: readonly Page[];
  readonly root: Page | null;
  readonly areas: readonly string[];
  readonly channel: RenderChannel;
};

type Reader = {
  readonly db: Database;
  readonly actor: Principal;
  readonly at: Date;
  readonly channel: RenderChannel;
};
type Drawn = { readonly areas: readonly string[]; readonly stories: readonly string[] };
type Section = BinderSection & SourceHash & Drawn;
type PageDrawn = Drawn & { readonly html: string };

const DEEPEST = 20;
const CHILDREN = 200;

async function storiesDrawn(reader: Reader, page: Page): Promise<readonly string[]> {
  const { db, actor, at, channel } = reader;
  const sources = await embedSources(db, actor, page.bodyMd, at, channel);
  return [page.id, ...embeddedPages(sources)];
}

async function pageDrawn(reader: Reader, page: Page, commit: string): Promise<PageDrawn> {
  const { db, actor, at, channel } = reader;
  const screen = screenOf(db, actor, at);
  const rendered = await renderPageIn(db, { actor, at, channel }, page, commit);
  const viewed = await withViews(db, screen, rendered);
  const { html, areas } = await withPanels(db, screen, page, viewed);
  const stories = await storiesOnly(db, await storiesDrawn(reader, page));
  return { html, areas: [...new Set([page.jdArea, ...areas])], stories };
}

export async function printPage(
  db: Database,
  actor: Principal,
  pageId: string,
  at: Date,
  commit: string,
): Promise<Printable | null> {
  const printed = await printPageIn(db, actor, { pageId, at, commit }, 'platform');
  return printed === 'story_above_channel' ? null : printed;
}

export async function printPageIn(
  db: Database,
  actor: Principal,
  asked: { readonly pageId: string; readonly at: Date; readonly commit: string },
  channel: RenderChannel,
): Promise<Printable | 'story_above_channel' | null> {
  const { pageId, at, commit } = asked;
  const reader = { db, actor, at, channel };
  const page = await readPageIn(db, actor, pageId, at, channel);
  if (page === null || page === 'story_above_channel') return page;
  const drawn = await pageDrawn(reader, page, commit);
  return {
    title: page.title,
    bodyHtml: titled(page.title, drawn.html),
    printed: await pagePrinted(reader, page),
    areas: drawn.areas,
    stories: drawn.stories,
  };
}

async function readable(reader: Reader, ids: readonly string[]): Promise<readonly Page[]> {
  const found: Page[] = [];
  for (const id of new Set(ids)) {
    const page = await readPage(reader.db, reader.actor, id, reader.at, reader.channel);
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

function planOf(
  reader: Reader,
  title: string,
  pages: readonly Page[],
  root: Page | null,
): BinderPlan {
  const areas = [...new Set(pages.map((page) => page.jdArea))];
  return { title, pages, root, areas, channel: reader.channel };
}

async function rootPlan(
  reader: Reader,
  request: { readonly rootPageId: string; readonly title?: string | undefined },
): Promise<BinderPlan | BinderRefusal> {
  const { db, actor, at, channel } = reader;
  const root = await readPage(db, actor, request.rootPageId, at, channel);
  if (root === null) return 'binder_empty';
  const found = [root.id];
  await walk(reader, root.id, 1, found);
  if (found.length > binderLimit) return 'binder_too_large';
  return planOf(reader, request.title ?? root.title, await readable(reader, found), root);
}

export async function binderPlan(
  db: Database,
  actor: Principal,
  request: BinderRequest,
  at: Date,
): Promise<BinderPlan | BinderRefusal> {
  const reader = { db, actor, at, channel: request.channel ?? 'platform' };
  if ('rootPageId' in request) return rootPlan(reader, request);
  const pages = await readable(reader, request.pageIds);
  return pages.length === 0 ? 'binder_empty' : planOf(reader, request.title, pages, null);
}

async function sectionsOf(reader: Reader, plan: BinderPlan, commit: string): Promise<Section[]> {
  const sections: Section[] = [];
  for (const page of plan.pages) {
    const drawn = await pageDrawn(reader, page, commit);
    sections.push({
      title: page.title,
      reference: pageReference(page),
      ...drawn,
      ...(await pageSourceHash(reader, page)),
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
  const sections = await sectionsOf({ db, actor, at, channel: plan.channel }, plan, commit);
  const cover = { title: plan.title, exportedBy: exporterOf(actor), exportedOn: formatDate(at) };
  const hashed = sections.map(({ reference, sourceSha256 }) => ({
    reference,
    sha256: sourceSha256,
  }));
  const withheld = sections.some((section) => section.withheld);
  return {
    title: plan.title,
    bodyHtml: binderBody(sections, cover),
    printed: {
      reference: binderReference(plan),
      filters: sections.map((section) => `page=${section.reference}`),
      hashInput: { kind: 'hash', sourceSha256: await sha256Hex(canonicalJson(hashed)), withheld },
    },
    areas: [...new Set([...plan.areas, ...sections.flatMap((section) => section.areas)])],
    stories: [...new Set(sections.flatMap((section) => section.stories))],
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

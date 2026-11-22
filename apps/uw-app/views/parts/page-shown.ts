import type { Context } from 'hono';
import {
  knowledgeFrontmatterSchema,
  type JdCategory,
  type Page,
  type PageEntry,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { AppEnv } from '../../deps.ts';
import { pageHistory, type PageVersion } from '../../pages/history.ts';
import { backlinksOf } from '../../pages/links.ts';
import { listPages } from '../../pages/listing.ts';
import { readPage } from '../../pages/store.ts';
import { ancestorsOf, type Ancestor } from '../../pages/tree.ts';
import type { ScreenKernel } from './frame.tsx';
import { moduleCodes, pageNames } from './names.ts';
import { agentQueuesPath, pagePath, wikiPath } from './paths.ts';
import { wikiBranch } from './wiki-tree.ts';

export const pageLink =
  'font-heavy text-accent-text underline outline-offset-2 outline-accent-text focus-visible:outline-2';

export const typeWords: Readonly<Record<string, string>> = {
  skill: 'Instructions page',
  persona: 'Agent page',
  learning: 'Learning',
  knowledge: 'Knowledge page',
};

const BACK = /^\/harnesses\/[0-9a-f-]{36}\/controls$/;
const MIRRORED = 'issue';

export function backOf(raw: string | undefined): string | null {
  return raw !== undefined && BACK.test(raw) ? raw : null;
}

export type ShownPage = {
  readonly page: Page;
  readonly versions: readonly PageVersion[];
  readonly canEdit: boolean;
  readonly ancestors: readonly Ancestor[];
  readonly children: readonly PageEntry[];
  readonly backlinks: readonly PageEntry[];
};

const CHILDREN_SHOWN = 200;

export async function shownPage(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  pageId: string,
): Promise<ShownPage | null> {
  const database = c.get('database');
  if (database === null) return null;
  const { actor } = screen.caller;
  const page = await readPage(database.db, actor, pageId, screen.at);
  const versions = await pageHistory(database.db, actor, pageId, screen.at);
  if (page === null || versions === null) return null;
  const mayWrite = can(actor, 'write', { kind: 'area', area: page.jdArea }, screen.at);
  const ancestors = await ancestorsOf(database.db, actor, page, screen.at);
  const under = { parent: page.id, limit: CHILDREN_SHOWN };
  const children = (await listPages(database.db, actor, under, screen.at))?.pages ?? [];
  const backlinks = await backlinksOf(database.db, actor, page.id, screen.at);
  const canEdit = mayWrite && page.type !== MIRRORED;
  return { page, versions, canEdit, ancestors, children, backlinks };
}

function knowledgeCrumbs(shown: ShownPage) {
  const filed = knowledgeFrontmatterSchema.safeParse(shown.page.frontmatter);
  const category = filed.success
    ? [{ label: filed.data.jd_category, href: wikiPath(filed.data.jd_category) }]
    : [];
  const parents = shown.ancestors.map((parent) => ({
    label: parent.title,
    href: pagePath(parent.id),
  }));
  return [{ label: pageNames.wiki, href: wikiPath() }, ...category, ...parents];
}

export function pageSpec(shown: ShownPage, last: string | null) {
  const { page } = shown;
  const wiki = page.type === 'knowledge';
  const lead = wiki
    ? knowledgeCrumbs(shown)
    : [{ label: pageNames.agentQueues, href: agentQueuesPath() }];
  const here =
    last === null
      ? [{ label: page.title }]
      : [{ label: page.title, href: pagePath(page.id) }, { label: last }];
  return {
    title: page.title,
    current: wiki ? wikiPath() : pagePath(page.id),
    code: wiki ? moduleCodes.pages : moduleCodes.agentQueues,
    crumbs: [...lead, ...here],
  };
}

export function categoryOf(page: Page): JdCategory | null {
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  return page.type === 'knowledge' && filed.success ? filed.data.jd_category : null;
}

export async function pageScreenSpec(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  shown: ShownPage,
  last: string | null,
  pages?: readonly PageEntry[],
) {
  const spec = pageSpec(shown, last);
  const database = c.get('database');
  const category = categoryOf(shown.page);
  if (category === null || database === null) return spec;
  const { page, ancestors } = shown;
  const current = { id: page.id, title: page.title, topId: ancestors[0]?.id ?? page.id };
  const here = { category, current, ...(pages === undefined ? {} : { pages }) };
  const branch = await wikiBranch(database.db, screen.caller.actor, screen.at, here);
  return { ...spec, current: pagePath(shown.page.id), branch };
}

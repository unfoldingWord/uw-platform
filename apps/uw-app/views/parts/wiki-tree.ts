import { areaOfCategory, type JdCategory, type PageCategory, type PageEntry } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import type { NavItem } from '@uw/ui/components/sidebar.tsx';
import { categoryCounts, pagesInCategory } from '../../pages/categories.ts';
import { lapsedCount } from '../../pages/verification.ts';
import type { Branch } from './frame.tsx';
import { areasWithin, platformAreas } from './names.ts';
import { pagePath, wikiAreaPath, wikiPath, wikiReviewPath } from './paths.ts';

export const PAGES_SHOWN = 25;

export type Group = {
  readonly code: string;
  readonly name: string;
  readonly categories: readonly PageCategory[];
};

export type Here = {
  readonly area?: string;
  readonly category?: JdCategory;
  readonly pages?: readonly PageEntry[];
  readonly lapsed?: number;
  readonly current?: Current;
};

export function groupsOf(categories: readonly PageCategory[]): readonly Group[] {
  return platformAreas
    .map((area) => {
      const within = areasWithin(area.code);
      const held = categories.filter((category) => within.includes(category.area));
      return { code: area.code, name: area.name, categories: held };
    })
    .filter((group) => group.categories.length > 0);
}

function topPages(entries: readonly PageEntry[]): readonly PageEntry[] {
  return entries.filter((entry) => entry.parentId === null);
}

export function neighboursOf(
  entries: readonly PageEntry[],
  pageId: string,
): { readonly previous: PageEntry | null; readonly next: PageEntry | null } {
  const self = entries.find((entry) => entry.id === pageId);
  if (self === undefined) return { previous: null, next: null };
  const siblings = entries.filter((entry) => entry.parentId === self.parentId);
  const index = siblings.findIndex((entry) => entry.id === pageId);
  return { previous: siblings[index - 1] ?? null, next: siblings[index + 1] ?? null };
}

type Current = { readonly id: string; readonly title: string; readonly topId: string };

function shownTop(top: readonly PageEntry[], current: Current | undefined): readonly PageEntry[] {
  const shown = top.slice(0, PAGES_SHOWN);
  if (current === undefined || shown.some((entry) => entry.id === current.topId)) return shown;
  const held = top.find((entry) => entry.id === current.topId);
  return held === undefined ? shown : [...shown, held];
}

function rowsFor(entry: PageEntry, current: Current | undefined): readonly NavItem[] {
  const row: NavItem = { label: entry.title, href: pagePath(entry.id), depth: 3 };
  if (current === undefined || entry.id !== current.topId || current.id === entry.id) return [row];
  const below: NavItem = { label: current.title, href: pagePath(current.id), depth: 3 };
  return [{ ...row, open: true }, below];
}

function pageRows(
  category: JdCategory,
  entries: readonly PageEntry[],
  here: Here,
): readonly NavItem[] {
  const top = topPages(entries);
  const rows = shownTop(top, here.current).flatMap((entry) => rowsFor(entry, here.current));
  if (top.length <= PAGES_SHOWN) return rows;
  return [...rows, { label: `More in ${category}`, href: wikiPath(category), depth: 3 }];
}

function categoryRows(group: Group, here: Here): readonly NavItem[] {
  return group.categories.flatMap((category) => {
    const named =
      category.name === null
        ? { label: category.code }
        : { label: category.name, code: category.code };
    const row: NavItem = {
      ...named,
      href: wikiPath(category.code),
      depth: 2,
      open: category.code === here.category,
    };
    if (category.code !== here.category || here.pages === undefined) return [row];
    return [row, ...pageRows(category.code, here.pages, here)];
  });
}

function areaOf(here: Here): string | null {
  if (here.category !== undefined) return areaOfCategory(here.category);
  return here.area ?? null;
}

function groupRows(group: Group, here: Here): readonly NavItem[] {
  const first = group.categories[0]?.area ?? group.code;
  const area = areaOf(here);
  const inside = area !== null && areasWithin(group.code).includes(area);
  const row: NavItem = {
    label: group.name,
    href: wikiAreaPath(first),
    code: group.code,
    depth: 1,
    open: inside,
  };
  return inside ? [row, ...categoryRows(group, here)] : [row];
}

function reviewRow(lapsed: number | undefined): readonly NavItem[] {
  if (lapsed === undefined || lapsed === 0) return [];
  const count = { kind: 'quiet' as const, text: String(lapsed) };
  return [{ label: 'Needs review', href: wikiReviewPath(), depth: 1, count }];
}

export function branchOf(groups: readonly Group[], here: Here): Branch {
  const items = [...groups.flatMap((group) => groupRows(group, here)), ...reviewRow(here.lapsed)];
  return { under: wikiPath(), items };
}

export async function wikiBranch(
  db: Executor,
  actor: Principal,
  at: Date,
  here: Here,
): Promise<Branch> {
  const listing =
    here.pages !== undefined || here.category === undefined
      ? Promise.resolve(here.pages ?? null)
      : pagesInCategory(db, actor, here.category, at);
  const [categories, pages, lapsed] = await Promise.all([
    categoryCounts(db, actor, at),
    listing,
    lapsedCount(db, actor, at),
  ]);
  const listed = pages === null ? {} : { pages };
  return branchOf(groupsOf(categories), { ...here, lapsed, ...listed });
}

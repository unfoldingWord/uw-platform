import { areaOfCategory, type JdCategory, type PageCategory, type PageEntry } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import type { NavItem } from '@uw/ui/components/sidebar.tsx';
import { categoryCounts, pagesInCategory } from '../../pages/categories.ts';
import type { Branch } from './frame.tsx';
import { areasWithin, platformAreas } from './names.ts';
import { pagePath, wikiAreaPath, wikiPath } from './paths.ts';

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

function pageRows(category: JdCategory, entries: readonly PageEntry[]): readonly NavItem[] {
  const top = topPages(entries);
  const rows: NavItem[] = top
    .slice(0, PAGES_SHOWN)
    .map((entry) => ({ label: entry.title, href: pagePath(entry.id), depth: 3 }));
  if (top.length > PAGES_SHOWN) {
    rows.push({ label: `More in ${category}`, href: wikiPath(category), depth: 3 });
  }
  return rows;
}

function categoryRows(group: Group, here: Here): readonly NavItem[] {
  return group.categories.flatMap((category) => {
    const row: NavItem = {
      label: category.name ?? `Category ${category.code}`,
      href: wikiPath(category.code),
      code: category.code,
      depth: 2,
      open: category.code === here.category,
    };
    if (category.code !== here.category || here.pages === undefined) return [row];
    return [row, ...pageRows(category.code, here.pages)];
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

export function branchOf(groups: readonly Group[], here: Here): Branch {
  return { under: wikiPath(), items: groups.flatMap((group) => groupRows(group, here)) };
}

export async function wikiBranch(
  db: Executor,
  actor: Principal,
  at: Date,
  here: Here,
): Promise<Branch> {
  const groups = groupsOf(await categoryCounts(db, actor, at));
  const pages =
    here.pages ??
    (here.category === undefined
      ? undefined
      : ((await pagesInCategory(db, actor, here.category, at)) ?? undefined));
  return branchOf(groups, pages === undefined ? here : { ...here, pages });
}

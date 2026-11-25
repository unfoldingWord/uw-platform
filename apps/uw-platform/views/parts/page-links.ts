import type { PageEntry } from '@uw/contracts';
import type { LinkNode } from '@uw/ui/components/link-tree.tsx';
import { treeOf, type TreeNode } from '../../pages/tree.ts';
import { pagePath } from './paths.ts';

function linkOf(node: TreeNode): LinkNode {
  return {
    label: node.page.title,
    href: pagePath(node.page.id),
    children: node.children.map(linkOf),
  };
}

export function pageLinks(entries: readonly PageEntry[]): readonly LinkNode[] {
  return treeOf(entries).map(linkOf);
}

export function byCategory(
  entries: readonly PageEntry[],
): ReadonlyMap<string, readonly PageEntry[]> {
  const held = new Map<string, PageEntry[]>();
  for (const entry of entries) {
    if (entry.category === null) continue;
    held.set(entry.category, [...(held.get(entry.category) ?? []), entry]);
  }
  return held;
}

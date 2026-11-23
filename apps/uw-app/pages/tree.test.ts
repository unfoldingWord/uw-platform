import { describe, expect, it } from 'vitest';
import type { PageEntry } from '@uw/contracts';
import { treeOf } from './tree.ts';

function entry(id: number, parent: number | null): PageEntry {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id: uuid(id),
    type: 'knowledge',
    jdArea: '00-09',
    slug: `page-${String(id)}`,
    title: `Page ${String(id)}`,
    status: 'active',
    parentId: parent === null ? null : uuid(parent),
    version: 1,
    category: '01',
    jdId: null,
    updatedAt: '2026-11-20T09:00:00.000Z',
  };
}

const titles = (nodes: ReturnType<typeof treeOf>): unknown[] =>
  nodes.map((node) => [node.page.title, titles(node.children)]);

describe('#175 the pages of a category form a tree', () => {
  it('nests each page under its parent, in the order given', () => {
    const tree = treeOf([entry(1, null), entry(2, 1), entry(3, 2), entry(4, null)]);
    expect(titles(tree)).toEqual([
      ['Page 1', [['Page 2', [['Page 3', []]]]]],
      ['Page 4', []],
    ]);
  });

  it('shows a page whose parent is not in the list at the top, so nothing is lost', () => {
    expect(titles(treeOf([entry(2, 9), entry(3, 2)]))).toEqual([['Page 2', [['Page 3', []]]]]);
  });
});

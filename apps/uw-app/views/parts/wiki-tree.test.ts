import { describe, expect, it } from 'vitest';
import type { PageCategory, PageEntry } from '@uw/contracts';
import type { NavSection } from '@uw/ui/components/sidebar.tsx';
import { withBranch } from './frame.tsx';
import { PAGES_SHOWN, branchOf, groupsOf, neighboursOf } from './wiki-tree.ts';

const at = '2026-10-01T00:00:00.000Z';

function entry(id: string, title: string, parentId: string | null = null): PageEntry {
  return {
    id,
    type: 'knowledge',
    jdArea: '00-09',
    slug: id,
    title,
    status: 'active',
    parentId,
    version: 1,
    category: '01',
    jdId: null,
    updatedAt: at,
  };
}

const categories: readonly PageCategory[] = [
  { code: '01', area: '00-09', name: 'Using the wiki', pages: 3 },
  { code: '61', area: '60-69', name: null, pages: 1 },
];

const filed = [
  entry('a', 'Alpha'),
  entry('b', 'Bravo'),
  entry('b1', 'Bravo child', 'b'),
  entry('c', 'Charlie'),
];

describe('ADR 0026 the page tree shows where a reader is and nothing they may not read', () => {
  it('opens only the area group and category the reader is in, and lists its top pages', () => {
    const branch = branchOf(groupsOf(categories), { category: '01', pages: filed });
    expect(branch.under).toBe('/wiki');
    expect(branch.items.map((item) => [item.label, item.depth, item.open === true])).toEqual([
      ['unfoldingWord Home', 1, true],
      ['Using the wiki', 2, true],
      ['Alpha', 3, false],
      ['Bravo', 3, false],
      ['Charlie', 3, false],
      ['Field Programs', 1, false],
    ]);
  });

  it('keeps every group closed where no category is open', () => {
    const branch = branchOf(groupsOf(categories), {});
    expect(branch.items.every((item) => item.depth === 1 && item.open !== true)).toBe(true);
  });

  it('names a category without a name by its code, and ends a long category with More', () => {
    const many = Array.from({ length: PAGES_SHOWN + 2 }, (_, index) =>
      entry(`p${String(index)}`, `Page ${String(index)}`),
    );
    const branch = branchOf(groupsOf(categories), { category: '61', pages: many });
    const labels = branch.items.map((item) => item.label);
    expect(labels).toContain('Category 61');
    expect(labels.at(-1)).toBe('More in 61');
    expect(branch.items.filter((item) => item.depth === 3)).toHaveLength(PAGES_SHOWN + 1);
  });

  it('splices the branch under the Pages & Wiki row and marks that row open', () => {
    const sections: readonly NavSection[] = [
      {
        items: [
          { label: 'Today', href: '/' },
          { label: 'Pages & Wiki', href: '/wiki' },
        ],
      },
    ];
    const branch = { under: '/wiki', items: [{ label: 'Area', href: '/wiki/areas/00-09' }] };
    const [section] = withBranch(sections, branch);
    expect(section?.items.map((item) => [item.label, item.open === true])).toEqual([
      ['Today', false],
      ['Pages & Wiki', true],
      ['Area', false],
    ]);
  });
});

describe('ADR 0026 previous and next walk the pages beside this one', () => {
  it('steps among pages with the same parent, in listed order', () => {
    expect(neighboursOf(filed, 'b')).toMatchObject({ previous: { id: 'a' }, next: { id: 'c' } });
    expect(neighboursOf(filed, 'a')).toMatchObject({ previous: null, next: { id: 'b' } });
    expect(neighboursOf(filed, 'b1')).toEqual({ previous: null, next: null });
    expect(neighboursOf(filed, 'missing')).toEqual({ previous: null, next: null });
  });
});

import { describe, expect, it } from 'vitest';
import { savedViewSchema, type CollectionRow } from '@uw/contracts';
import { testProgram } from '../../testing/collection-definitions.ts';
import { drawnTable, TITLE_COLUMN } from './collection-table.tsx';

const properties = testProgram.properties.filter((p) => ['phase', 'due', 'size'].includes(p.key));

const rows: CollectionRow[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Gateway',
    jdArea: '60-69',
    version: 1,
    values: { phase: 'idea', due: '2026-12-01', size: 'large' },
    group: null,
  },
];

function viewWith(settings: Record<string, unknown>) {
  return savedViewSchema.parse({
    id: '00000000-0000-4000-8000-0000000000aa',
    collection: 'tprogram',
    position: 0,
    ownerId: null,
    settings: { name: 'Table', layout: 'table', scope: 'shared', ...settings },
  });
}

function drawn(view: ReturnType<typeof viewWith> | null) {
  return drawnTable({
    properties,
    view,
    rows,
    cell: (row, property) => `${property.key}:${String(row.values[property.key])}`,
    titleCell: (row) => row.title,
  });
}

describe('#215 the table layout takes its column model from TanStack Table', () => {
  it('shows the title then every property in definition order when the view chooses none', () => {
    const table = drawn(null);
    expect(table.columns.map((c) => c.key)).toEqual([TITLE_COLUMN, 'phase', 'due', 'size']);
    expect(table.rows[0]).toEqual({
      [TITLE_COLUMN]: 'Gateway',
      phase: 'phase:idea',
      due: 'due:2026-12-01',
      size: 'size:large',
    });
  });

  it('follows the view order, hides what it hides, and sizes what it sizes', () => {
    const view = viewWith({
      properties: [
        { property: 'size', visible: true, width: 320 },
        { property: 'phase', visible: true, width: 180 },
        { property: 'due', visible: false, width: null },
      ],
    });
    const table = drawn(view);
    expect(table.columns.map((c) => [c.key, c.wide])).toEqual([
      [TITLE_COLUMN, 'narrow'],
      ['size', 'wide'],
      ['phase', 'narrow'],
    ]);
    expect(Object.keys(table.rows[0] ?? {})).toEqual([TITLE_COLUMN, 'size', 'phase']);
  });
});

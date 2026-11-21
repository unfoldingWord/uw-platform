import type { Child } from 'hono/jsx';
import {
  columnOrderingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  constructTable,
  createColumnHelper,
  tableFeatures,
} from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import type { CollectionRow, PropertyDefinition, SavedView } from '@uw/contracts';
import type { Column } from '@uw/ui/components/table.tsx';

export const TITLE_COLUMN = '__title';

const DEFAULT_SIZE = 150;

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  columnOrderingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
});

const helper = createColumnHelper<typeof features, CollectionRow>();

export type TableInput = {
  readonly properties: readonly PropertyDefinition[];
  readonly view: SavedView | null;
  readonly rows: readonly CollectionRow[];
  readonly cell: (row: CollectionRow, property: PropertyDefinition) => Child;
  readonly titleCell: (row: CollectionRow) => Child;
};

export type DrawnTable = {
  readonly columns: readonly Column[];
  readonly rows: readonly Readonly<Record<string, Child>>[];
};

function chosen(view: SavedView | null) {
  return view?.settings.properties ?? [];
}

function visibilityOf(input: TableInput): Record<string, boolean> {
  const settings = chosen(input.view);
  const shown = new Set(settings.filter((p) => p.visible).map((p) => p.property));
  if (shown.size === 0) return {};
  return Object.fromEntries(input.properties.map((p) => [p.key, shown.has(p.key)]));
}

function orderOf(input: TableInput): string[] {
  const named = chosen(input.view).map((p) => p.property);
  const rest = input.properties.map((p) => p.key).filter((key) => !named.includes(key));
  return [TITLE_COLUMN, ...named, ...rest];
}

function sizingOf(input: TableInput): Record<string, number> {
  return Object.fromEntries(
    chosen(input.view).flatMap((p) => (p.width === null ? [] : [[p.property, p.width] as const])),
  );
}

function wideOf(size: number): Column['wide'] {
  if (size === DEFAULT_SIZE) return undefined;
  if (size < 200) return 'narrow';
  return size < 300 ? 'medium' : 'wide';
}

function tableOf(input: TableInput) {
  const columns = helper.columns([
    helper.accessor((row) => row.title, { id: TITLE_COLUMN, header: 'Name', size: 160 }),
    ...input.properties.map((property) =>
      helper.accessor((row) => row.values[property.key], {
        id: property.key,
        header: property.name,
      }),
    ),
  ]);
  return constructTable({
    features,
    columns,
    data: [...input.rows],
    getRowId: (row) => row.id,
    initialState: {
      columnOrder: orderOf(input),
      columnSizing: sizingOf(input),
      columnVisibility: visibilityOf(input),
    },
  });
}

export function drawnTable(input: TableInput): DrawnTable {
  const table = tableOf(input);
  const byKey = new Map(input.properties.map((p) => [p.key, p]));
  const headers = table.getHeaderGroups().at(0)?.headers ?? [];
  const columns = headers.map((header) => ({
    key: header.column.id,
    label: header.column.id === TITLE_COLUMN ? 'Name' : (byKey.get(header.column.id)?.name ?? ''),
    wide: header.column.id === TITLE_COLUMN ? ('narrow' as const) : wideOf(header.getSize()),
  }));
  const rows = table.getRowModel().rows.map((row) =>
    Object.fromEntries(
      row.getVisibleCells().map((cell) => {
        const property = byKey.get(cell.column.id);
        const shown =
          property === undefined
            ? input.titleCell(row.original)
            : input.cell(row.original, property);
        return [cell.column.id, shown] as const;
      }),
    ),
  );
  return { columns, rows };
}

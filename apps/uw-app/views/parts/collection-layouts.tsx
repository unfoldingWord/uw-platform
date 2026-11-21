import type { Child } from 'hono/jsx';
import {
  isWritableProperty,
  type CollectionDefinition,
  type CollectionRow,
  type PropertyDefinition,
  type RowsReply,
} from '@uw/contracts';
import { KanbanCard, type ShownFact } from '@uw/ui/components/kanban-card.tsx';
import { Table, type Column } from '@uw/ui/components/table.tsx';
import type { Names } from '../../collections/display.ts';
import { CellValue, propertyValue, RowTitle } from './collection-cells.tsx';
import { PropertyEditor, type Choice } from './collection-edit.tsx';
import { collectionRowPath } from './paths.ts';

export type LayoutProps = {
  readonly definition: CollectionDefinition;
  readonly reply: RowsReply;
  readonly names: Names;
  readonly mayWrite: (row: CollectionRow) => boolean;
  readonly people: readonly Choice[];
  readonly covers: ReadonlyMap<string, string>;
  readonly month: string;
};

const inlineTypes: ReadonlySet<string> = new Set([
  'text',
  'number',
  'date',
  'select',
  'status',
  'checkbox',
  'url',
  'email',
  'phone',
]);

const TITLE_COLUMN = '__title';

function shownProperties(props: LayoutProps): readonly PropertyDefinition[] {
  return props.reply.columns.flatMap((column) =>
    props.definition.properties.filter((p) => p.key === column.key && p.config.type !== 'title'),
  );
}

function wideOf(props: LayoutProps, key: string): Column['wide'] {
  const width =
    props.reply.view?.settings.properties.find((p) => p.property === key)?.width ?? null;
  if (width === null) return undefined;
  if (width < 200) return 'narrow';
  return width < 300 ? 'medium' : 'wide';
}

function cell(layout: LayoutProps, row: CollectionRow, property: PropertyDefinition): Child {
  const value = propertyValue(row, property.key);
  const editable =
    layout.mayWrite(row) && isWritableProperty(property) && inlineTypes.has(property.config.type);
  if (!editable) return <CellValue property={property} value={value} names={layout.names} />;
  const target = {
    collection: layout.definition.key,
    rowId: row.id,
    rowTitle: row.title,
    property,
    value,
    compact: true,
    people: layout.people,
    rows: [],
  };
  return <PropertyEditor target={target} />;
}

export function TableLayout(props: LayoutProps) {
  const shown = shownProperties(props);
  const columns: Column[] = [
    { key: TITLE_COLUMN, label: 'Name', wide: 'narrow' },
    ...shown.map((p) => ({ key: p.key, label: p.name, wide: wideOf(props, p.key) })),
  ];
  const rows = props.reply.rows.map((row) =>
    Object.fromEntries([
      [TITLE_COLUMN, <RowTitle collection={props.definition.key} row={row} />],
      ...shown.map((p) => [p.key, cell(props, row, p)] as const),
    ]),
  );
  return <Table caption={props.definition.name} columns={columns} rows={rows} />;
}

export function rowFacts(layout: LayoutProps, row: CollectionRow): readonly ShownFact[] {
  return shownProperties(layout).map((property) => ({
    label: property.name,
    value: (
      <CellValue
        property={property}
        value={propertyValue(row, property.key)}
        names={layout.names}
      />
    ),
  }));
}

export function ListLayout(props: LayoutProps) {
  const shown = shownProperties(props);
  return (
    <ul class="m-0 flex list-none flex-col divide-y divide-line-soft rounded-md border border-line bg-surface p-0">
      {props.reply.rows.map((row) => (
        <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
          <span class="min-w-0 font-heavy">
            <RowTitle collection={props.definition.key} row={row} />
          </span>
          {shown.map((property) => (
            <span class="flex items-center gap-1 text-text-2">
              <span class="sr-only">{`${property.name}: `}</span>
              <CellValue
                property={property}
                value={propertyValue(row, property.key)}
                names={props.names}
              />
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

function Grid(props: { readonly layout: LayoutProps; readonly rows: readonly CollectionRow[] }) {
  const { layout } = props;
  return (
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {props.rows.map((row) => (
        <KanbanCard
          title={row.title === '' ? 'Untitled' : row.title}
          href={collectionRowPath(layout.definition.key, row.id)}
          meta={[]}
          facts={rowFacts(layout, row)}
          cover={layout.covers.get(row.id)}
        />
      ))}
    </div>
  );
}

export function GalleryLayout(props: LayoutProps) {
  const groups = props.reply.groups;
  if (groups === null) return <Grid layout={props} rows={props.reply.rows} />;
  return (
    <div class="flex flex-col gap-5">
      {groups
        .filter((group) => group.visible)
        .map((group) => (
          <section class="flex flex-col gap-2" aria-label={group.label}>
            <h2 class="m-0 text-sm font-heavy text-text-2">{`${group.label} (${group.count})`}</h2>
            <Grid
              layout={props}
              rows={props.reply.rows.filter((row) => row.group === group.value)}
            />
          </section>
        ))}
    </div>
  );
}

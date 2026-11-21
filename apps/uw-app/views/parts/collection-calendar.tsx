import type { CollectionRow, PropertyDefinition } from '@uw/contracts';
import { CategoryChart } from '@uw/ui/components/chart.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { formatDate, parseDate } from '@uw/core/dates';
import { propertyValue, RowTitle } from './collection-cells.tsx';
import type { LayoutProps } from './collection-layouts.tsx';
import { pageLink } from './page-shown.ts';
import { collectionViewPath } from './paths.ts';

const DAY = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function monthBounds(month: string): readonly [string, string] {
  const first = parseDate(`${month}-01`);
  const next = new Date(first.getTime());
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [formatDate(first), formatDate(new Date(next.getTime() - DAY))];
}

function shifted(month: string, by: number): string {
  const first = parseDate(`${month}-01`);
  first.setUTCMonth(first.getUTCMonth() + by);
  return formatDate(first).slice(0, 7);
}

function span(
  row: CollectionRow,
  property: PropertyDefinition | undefined,
): readonly [string, string] | null {
  if (property === undefined) return null;
  const value = propertyValue(row, property.key);
  if (typeof value === 'string') return [value, value];
  if (typeof value === 'object' && value !== null && 'start' in value) {
    const start = String(value.start);
    const end = 'end' in value && typeof value.end === 'string' ? value.end : start;
    return [start, end];
  }
  return null;
}

function daysOf(month: string): readonly string[] {
  const [first, last] = monthBounds(month);
  const start = parseDate(first);
  const lead = (start.getUTCDay() + 6) % 7;
  const days: string[] = Array.from({ length: lead }, () => '');
  for (let t = start.getTime(); formatDate(new Date(t)) <= last; t += DAY)
    days.push(formatDate(new Date(t)));
  return days;
}

function Day(props: {
  readonly layout: LayoutProps;
  readonly day: string;
  readonly rows: readonly CollectionRow[];
}) {
  if (props.day === '') return <li aria-hidden="true" class="min-h-size-8 rounded-sm bg-lane"></li>;
  return (
    <li class="flex min-h-size-8 min-w-0 flex-col gap-1 rounded-sm border border-line-soft bg-surface p-1">
      <span class="text-xs text-text-3">{props.day.slice(8)}</span>
      {props.rows.map((row) => (
        <span class="truncate text-xs">
          <RowTitle collection={props.layout.definition.key} row={row} />
        </span>
      ))}
    </li>
  );
}

export function CalendarLayout(props: LayoutProps) {
  const view = props.reply.view;
  const property = props.definition.properties.find((p) => p.key === view?.settings.dateProperty);
  const placed = props.reply.rows.flatMap((row) => {
    const found = span(row, property);
    return found === null ? [] : [{ row, start: found[0], end: found[1] }];
  });
  const viewPath = (month: string) =>
    collectionViewPath(props.definition.key, view?.id ?? '', `?month=${month}`);
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <a href={viewPath(shifted(props.month, -1))} class={pageLink}>
          Previous month
        </a>
        <h2 class="m-0 text-md font-heavy">{props.month}</h2>
        <a href={viewPath(shifted(props.month, 1))} class={pageLink}>
          Next month
        </a>
      </div>
      <div class="overflow-x-auto">
        <ol
          class="m-0 grid min-w-content grid-cols-7 gap-1 p-0"
          aria-label={`${props.definition.name}, ${props.month}`}
        >
          {WEEKDAYS.map((day) => (
            <li aria-hidden="true" class="list-none text-center text-xs font-heavy text-text-3">
              {day}
            </li>
          ))}
          {daysOf(props.month).map((day) => (
            <Day
              layout={props}
              day={day}
              rows={
                day === ''
                  ? []
                  : placed.filter((p) => p.start <= day && p.end >= day).map((p) => p.row)
              }
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function sums(props: LayoutProps, key: string | null): ReadonlyMap<string, number> | null {
  if (key === null) return null;
  const totals = new Map<string, number>();
  for (const row of props.reply.rows) {
    const value = propertyValue(row, key);
    const group = row.group ?? '';
    totals.set(group, (totals.get(group) ?? 0) + (typeof value === 'number' ? value : 0));
  }
  return totals;
}

type Figures = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'bar' | 'donut';
  readonly measure: string;
  readonly points: readonly { readonly label: string; readonly value: number }[];
};

function measureOf(props: LayoutProps, sumKey: string | null): string {
  if (sumKey === null) return 'Count';
  const named = props.definition.properties.find((p) => p.key === sumKey)?.name;
  return `Sum of ${named ?? sumKey}`;
}

function figuresOf(props: LayoutProps): Figures {
  const view = props.reply.view;
  const chart = view?.settings.chart ?? { kind: 'bar' as const, sum: null };
  const groups = (props.reply.groups ?? []).filter((group) => group.visible);
  const totals = sums(props, chart.sum);
  return {
    id: `chart-${(view?.id ?? 'view').slice(0, 8)}`,
    name: view?.settings.name ?? '',
    kind: chart.kind,
    measure: measureOf(props, chart.sum),
    points: groups.map((g) => ({ label: g.label, value: totals?.get(g.value) ?? g.count })),
  };
}

export function ChartLayout(props: LayoutProps) {
  const figures = figuresOf(props);
  return (
    <div class="flex flex-col gap-3">
      <CategoryChart
        id={figures.id}
        label={`${props.definition.name}: ${figures.name}`}
        kind={figures.kind}
        categories={figures.points.map((point) => point.label)}
        values={figures.points.map((point) => point.value)}
      />
      <Table
        caption={`${figures.name} figures`}
        columns={[
          { key: 'group', label: 'Group' },
          { key: 'value', label: figures.measure, numeric: true },
        ]}
        rows={figures.points.map((point) => ({ group: point.label, value: String(point.value) }))}
      />
    </div>
  );
}

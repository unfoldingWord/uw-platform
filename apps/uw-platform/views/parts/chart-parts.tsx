import type { ChartLineage, ChartTable } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { SpecChart } from '@uw/ui/components/spec-chart.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { UNSPECIFIED } from '../../charts/graph-drawing.ts';
import { cellOf } from '../../charts/query-types.ts';
import type { DrawnChart } from '../../charts/render.ts';
import { chartFilePath, type ChartFileFormat } from './paths.ts';

const files: readonly (readonly [ChartFileFormat, string])[] = [
  ['svg', 'SVG'],
  ['png', 'PNG'],
  ['csv', 'CSV'],
  ['json', 'JSON'],
];

type Ids = { readonly heading: string; readonly rows: string; readonly lineage: string };

const singleChartIds: Ids = {
  heading: 'chart-heading',
  rows: 'chart-rows-heading',
  lineage: 'chart-lineage-heading',
};

function Downloads(props: { readonly chartKey: string; readonly harnessId: string | null }) {
  return (
    <span data-pdf-hidden="" class="inline-flex flex-wrap items-center gap-2">
      {files.map(([format, label]) => (
        <ButtonLink
          href={chartFilePath(props.chartKey, props.harnessId, format)}
          variant="secondary"
          size="sm"
          label={`Download ${props.chartKey.replaceAll('_', ' ')} as ${label}`}
        >
          {label}
        </ButtonLink>
      ))}
    </span>
  );
}

export function ChartPicture(props: {
  readonly drawn: DrawnChart;
  readonly chartKey: string;
  readonly harnessId: string | null;
  readonly ids?: Ids;
}) {
  const { drawn } = props;
  return (
    <Section
      title={drawn.spec.title}
      headingId={(props.ids ?? singleChartIds).heading}
      sub={`As of ${formatInstant(new Date(drawn.lineage.asOf))}`}
      actions={<Downloads chartKey={props.chartKey} harnessId={props.harnessId} />}
    >
      {drawn.drawing.notes.map((note) => (
        <Note>{note}</Note>
      ))}
      <SpecChart {...drawn.drawing} />
    </Section>
  );
}

function cellText(drawn: DrawnChart, key: string, cell: unknown): string {
  if (cell === null || cell === undefined) {
    const percent = drawn.spec.format.y === 'percent' && drawn.spec.encodings.y.includes(key);
    return percent ? `${UNSPECIFIED.charAt(0).toUpperCase()}${UNSPECIFIED.slice(1)}` : 'None';
  }
  if (typeof cell !== 'number') return String(cell);
  return drawn.spec.encodings.y.includes(key) ? drawn.drawing.figure(cell) : formatCount(cell);
}

function numeric(table: ChartTable, key: string): boolean {
  return table.rows.some((row) => typeof cellOf(row, key) === 'number');
}

export function ChartData(props: {
  readonly drawn: DrawnChart;
  readonly ids?: Ids;
  readonly title?: string;
}) {
  const { drawn } = props;
  const { table } = drawn;
  const columns = table.columns.map((column) => ({
    ...column,
    numeric: numeric(table, column.key),
  }));
  const rows = table.rows.map((row) =>
    Object.fromEntries(
      table.columns.map((column) => [
        column.key,
        cellText(drawn, column.key, cellOf(row, column.key)),
      ]),
    ),
  );
  return (
    <Section
      title={props.title ?? 'The rows drawn'}
      headingId={(props.ids ?? singleChartIds).rows}
      flush
    >
      <Table caption={`${drawn.spec.title}, the rows drawn`} columns={columns} rows={rows} bare />
    </Section>
  );
}

function leftOutText(lineage: ChartLineage): string {
  if (lineage.excluded.count === 0) return 'Nothing';
  return lineage.excluded.reasons
    .map((each) => `${formatCount(each.count)}: ${each.reason.replaceAll('_', ' ')}`)
    .join('; ');
}

function staleText(lineage: ChartLineage): string {
  const { stale } = lineage;
  if (stale === null) return 'Fresh';
  return `${stale.reason.replaceAll('_', ' ')} since ${formatInstant(new Date(stale.since))}`;
}

export function ChartLineageRows(props: {
  readonly lineage: ChartLineage;
  readonly workflow?: string;
  readonly ids?: Ids;
  readonly title?: string;
}) {
  const { lineage } = props;
  const rows = [
    { what: 'Query', value: lineage.query },
    { what: 'Source', value: lineage.source },
    { what: 'As of', value: formatInstant(new Date(lineage.asOf)) },
    ...(props.workflow === undefined ? [] : [{ what: 'Workflow', value: props.workflow }]),
    { what: 'Left out', value: leftOutText(lineage) },
    ...(lineage.capped === null
      ? []
      : [
          {
            what: 'Read limit',
            value: `Newest ${formatCount(lineage.capped.newestEvents)} stage events`,
          },
        ]),
    { what: 'Source freshness', value: staleText(lineage) },
  ];
  const columns = [
    { key: 'what', label: 'Lineage' },
    { key: 'value', label: 'Value' },
  ];
  return (
    <Section
      title={props.title ?? 'Lineage'}
      headingId={(props.ids ?? singleChartIds).lineage}
      flush
    >
      <Table caption={props.title ?? 'Lineage'} columns={columns} rows={rows} bare />
    </Section>
  );
}

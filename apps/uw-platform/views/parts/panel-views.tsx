import type { Child } from 'hono/jsx';
import type { AuthoringProblem, Panel } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { formatFigure } from '@uw/core/money';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Kpi } from '@uw/ui/components/kpi.tsx';
import { BarsChart, TrendLine } from '@uw/ui/components/panel-chart.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { domId } from '@uw/ui/components/text.ts';
import type { MetricFigures } from '../../measures/metrics.ts';
import type { PanelData, PanelRead, ValuesTable } from '../../measures/panel-reads.ts';
import {
  coverageLine,
  figureText,
  pausedOf,
  reasonOf,
  runKindOf,
  runStateOf,
  valueText,
} from './measure-words.ts';
import { panelTable, type Cell, type PanelTable } from './panel-table.ts';
import { pageLink } from './page-shown.ts';

export type PanelShown = {
  readonly panel: Panel;
  readonly index: number;
  readonly scope: string;
  readonly read: PanelRead | null;
  readonly csv: string | null;
};

type Resource = MetricFigures['resources'][number];

function CellText(props: { readonly cell: Cell | undefined }) {
  const cell = props.cell;
  if (cell === undefined) return null;
  return (
    <span class="inline-flex flex-wrap items-center gap-2">
      {cell.text}
      {cell.held === null ? null : <Badge tone="held">{cell.held}</Badge>}
    </span>
  );
}

function DataTable(props: { readonly table: PanelTable }) {
  const { table } = props;
  const rows = table.rows.map((row) =>
    Object.fromEntries(
      table.columns.map((column) => [column.key, <CellText cell={row[column.key]} />]),
    ),
  );
  return <Table caption={table.caption} columns={table.columns} rows={rows} />;
}

function under(figures: MetricFigures): boolean {
  return figures.target !== null && figures.figure !== null && figures.figure < figures.target;
}

function FigurePanel(props: { readonly figures: MetricFigures }) {
  const { figures } = props;
  const target =
    figures.target === null ? '' : ` Target ${figureText(figures.target, figures.unit)}.`;
  const shortfall = under(figures) ? ' Under target.' : '';
  return (
    <Kpi
      label={figures.name}
      value={figures.figure === null ? 'Not scored' : figureText(figures.figure, figures.unit)}
      detail={`${coverageLine(figures.coverage)}.${target}${shortfall}`}
      tone={under(figures) ? 'held' : undefined}
    />
  );
}

function scoredOf(figures: MetricFigures): { readonly title: string; readonly value: number }[] {
  return figures.resources
    .flatMap((resource) =>
      typeof resource.value === 'number' ? [{ title: resource.title, value: resource.value }] : [],
    )
    .sort((a, b) => b.value - a.value);
}

function BarsPanel(props: { readonly figures: MetricFigures; readonly id: string }) {
  const { figures } = props;
  const scored = scoredOf(figures);
  if (scored.length === 0) return <p class="m-0 text-sm text-text-3">Nothing scored yet.</p>;
  return (
    <BarsChart
      id={props.id}
      label={`${figures.name} by resource, highest first`}
      names={scored.map((each) => each.title)}
      values={scored.map((each) => each.value)}
      target={figures.target}
      targetLabel={figures.target === null ? '' : `Target ${formatFigure(figures.target)}`}
    />
  );
}

function withBreaks(resource: Resource): (number | null)[] {
  const values: (number | null)[] = [];
  resource.points.forEach((point, index) => {
    const before = resource.points[index - 1];
    if (before !== undefined && before.toolVersion !== point.toolVersion) values.push(null);
    values.push(point.value);
  });
  return values;
}

function breakNote(resource: Resource): string | null {
  const versions = resource.points.flatMap((point, index) => {
    const before = resource.points[index - 1];
    if (before !== undefined && before.toolVersion === point.toolVersion) return [];
    return [point.toolVersion ?? 'an unknown version'];
  });
  if (versions.length < 2) return null;
  return `The line breaks where the tool changed from ${versions.join(' to ')}.`;
}

function TrendPanel(props: { readonly figures: MetricFigures; readonly id: string }) {
  const { figures } = props;
  return (
    <ul class="m-0 flex list-none flex-col gap-3 p-0">
      {figures.resources.map((resource, index) => (
        <li class="flex min-w-0 flex-col gap-1">
          <span class="text-sm font-semibold text-text">{resource.title}</span>
          {resource.points.length === 0 ? (
            <span class="text-sm text-text-3">Not scored yet.</span>
          ) : (
            <TrendLine
              id={`${props.id}-${String(index)}`}
              label={`${figures.name}, ${resource.title}`}
              values={withBreaks(resource)}
            />
          )}
          {breakNote(resource) === null ? null : (
            <span class="text-sm text-text-3">{breakNote(resource)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

type ListRow = ValuesTable['rows'][number];
type ValueType = ValuesTable['values'][number]['type'];

function unreadOf(row: ListRow): string | null {
  if (row.reason !== null) return `${row.title}, not scored: ${reasonOf(row.reason)}`;
  return row.observedAt === null ? `${row.title}, not yet observed` : null;
}

function ListItems(props: { readonly row: ListRow; readonly type: ValueType }) {
  const cell = props.row.cells[0] ?? null;
  const items = Array.isArray(cell)
    ? cell
    : cell === null
      ? []
      : [valueText(cell, props.type, null)];
  return (
    <details class="flex flex-col gap-2">
      <summary class="cursor-pointer text-sm font-semibold text-text outline-offset-2 outline-accent-text focus-visible:outline-2">
        {`${props.row.title}, ${String(items.length)} ${items.length === 1 ? 'item' : 'items'}`}
      </summary>
      <ul class="m-0 pl-5 text-sm text-text">
        {items.map((item) => (
          <li>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function ListPanel(props: { readonly table: ValuesTable }) {
  const type = props.table.values[0]?.type ?? 'text';
  return (
    <div class="flex flex-col gap-2">
      {props.table.rows.map((row) => {
        const unread = unreadOf(row);
        return unread === null ? (
          <ListItems row={row} type={type} />
        ) : (
          <p class="m-0 text-sm font-semibold text-text">{unread}</p>
        );
      })}
    </div>
  );
}

function StatusLines(props: { readonly data: Extract<PanelData, { kind: 'status' }> }) {
  const { data } = props;
  const last = data.lastRun;
  const lines = [
    last === null
      ? 'No run yet.'
      : `${runKindOf(last.kind)}: ${runStateOf(last.state)}${last.finishedAt === null ? '' : `, ${formatInstant(new Date(last.finishedAt))}`}.`,
    data.nextRunAt === null
      ? 'No run is scheduled.'
      : `Next run ${formatInstant(new Date(data.nextRunAt))}.`,
    `${coverageLine(data.table.coverage)}.`,
    ...(data.paused === null ? [] : [pausedOf(data.paused)]),
  ];
  return (
    <ul class="m-0 flex flex-col gap-1 pl-5 text-sm text-text">
      {lines.map((line) => (
        <li>{line}</li>
      ))}
    </ul>
  );
}

function drawn(panel: Panel, data: PanelData, id: string): Child {
  if (data.kind === 'status') return <StatusLines data={data} />;
  if (data.kind === 'values')
    return panel.kind === 'list' ? <ListPanel table={data.table} /> : null;
  if (panel.kind === 'figure') return <FigurePanel figures={data.figures} />;
  if (panel.kind === 'bars') return <BarsPanel figures={data.figures} id={id} />;
  return panel.kind === 'trend' ? <TrendPanel figures={data.figures} id={id} /> : null;
}

function asOfOf(data: PanelData): string | null {
  return data.kind === 'metric' ? data.figures.asOf : data.table.asOf;
}

function titleOf(shown: PanelShown): string {
  const { panel, read } = shown;
  if (panel.title !== undefined) return panel.title;
  const data = read?.data;
  if (data?.kind === 'metric') return data.figures.name;
  const measure = read?.measure.title ?? 'Measure';
  return panel.kind === 'status' ? `${measure}: status` : measure;
}

function Notice(props: { readonly children: string }) {
  return (
    <p data-embed-notice="" class="m-0 text-sm text-text-3">
      {props.children}
    </p>
  );
}

function Body(props: { readonly shown: PanelShown; readonly id: string }) {
  const { read, panel, csv } = props.shown;
  if (read === null) return <Notice>You do not have access to this panel's measure.</Notice>;
  if (read.data === null)
    return <Notice>This panel names something its measure does not keep.</Notice>;
  return (
    <>
      {drawn(panel, read.data, props.id)}
      {panel.kind === 'table' || panel.kind === 'list' ? null : (
        <details class="flex flex-col gap-2">
          <summary class="cursor-pointer text-sm text-text-2 outline-offset-2 outline-accent-text focus-visible:outline-2">
            The figures as a table
          </summary>
          <DataTable table={panelTable(panel, read.data, read.measure)} />
        </details>
      )}
      {panel.kind === 'table' ? (
        <DataTable table={panelTable(panel, read.data, read.measure)} />
      ) : null}
      {csv === null ? null : (
        <p data-pdf-hidden="" class="m-0 text-sm">
          <a href={csv} class={pageLink}>
            Download as CSV
          </a>
        </p>
      )}
    </>
  );
}

export function PanelView(props: { readonly shown: PanelShown }) {
  const { shown } = props;
  const id = domId('panel', shown.scope, String(shown.index));
  const asOf = shown.read?.data === null || shown.read === null ? null : asOfOf(shown.read.data);
  const sub =
    asOf === null ? 'Live, nothing observed yet' : `Live, as of ${formatInstant(new Date(asOf))}`;
  return (
    <Section
      title={titleOf(shown)}
      headingId={`${id}-title`}
      sub={sub}
      attrs={{ 'data-panel': shown.panel.kind }}
      tight
    >
      <Body shown={shown} id={id} />
    </Section>
  );
}

function problemText(problem: AuthoringProblem): string {
  const field = problem.path.replace(/^panels\.\d+\.?/, '');
  const where = field === '' ? '' : ` (${field})`;
  return `This panel could not be read${where}: ${problem.message}`;
}

export function UnreadablePanelView(props: {
  readonly index: number;
  readonly scope: string;
  readonly problem: AuthoringProblem;
}) {
  const id = domId('panel', props.scope, String(props.index));
  return (
    <Section
      title={`Panel ${String(props.index + 1)}`}
      headingId={`${id}-title`}
      attrs={{ 'data-panel': 'unreadable' }}
      tight
    >
      <Notice>{problemText(props.problem)}</Notice>
    </Section>
  );
}

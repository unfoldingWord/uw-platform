import type { MeasureValueDefinition, ObservedValue, Panel } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import type { Column } from '@uw/ui/components/table.tsx';
import type { MeasurePage } from '../../measures/measure-pages.ts';
import type { MetricFigures } from '../../measures/metrics.ts';
import type { PanelData, ResourceValues, ValuesTable } from '../../measures/panel-reads.ts';
import { figureText, reasonOf, valueText } from './measure-words.ts';

export type Cell = { readonly text: string; readonly held: string | null };
type PanelRow = Readonly<Record<string, Cell>>;
export type PanelTable = {
  readonly caption: string;
  readonly columns: readonly Column[];
  readonly rows: readonly PanelRow[];
};

type Threshold = { readonly op: 'at_least' | 'at_most'; readonly threshold: number };

const plain = (text: string): Cell => ({ text, held: null });

function observedCell(observedAt: string | null, reason: ResourceValues['reason']): Cell {
  if (reason !== null) return plain(`Not scored: ${reasonOf(reason)}`);
  return plain(observedAt === null ? 'Not yet observed' : formatInstant(new Date(observedAt)));
}

function valueOf(measure: MeasurePage, key: string): MeasureValueDefinition | undefined {
  return measure.measure.values.find((value) => value.key === key);
}

function metricRows(figures: MetricFigures, type: MeasureValueDefinition['type']): PanelRow[] {
  return figures.resources.map((resource) => ({
    resource: plain(resource.title),
    value: {
      text: valueText(resource.value, type, figures.unit),
      held: resource.meetsTarget === false ? 'Under target' : null,
    },
    observed: observedCell(resource.observedAt, resource.reason),
  }));
}

function trendRows(figures: MetricFigures): PanelRow[] {
  return figures.resources.map((resource) => {
    const versions = [...new Set(resource.points.map((point) => point.toolVersion ?? 'unknown'))];
    const last = resource.points.at(-1);
    return {
      resource: plain(resource.title),
      points: plain(String(resource.points.length)),
      latest: plain(last === undefined ? 'Not scored' : figureText(last.value, figures.unit)),
      versions: plain(versions.join(', ')),
    };
  });
}

function metricTable(panel: Panel, figures: MetricFigures, measure: MeasurePage): PanelTable {
  const caption = `${figures.name}, by resource`;
  if (panel.kind === 'trend') {
    const columns = [
      { key: 'resource', label: 'Resource' },
      { key: 'points', label: 'Points', numeric: true },
      { key: 'latest', label: 'Latest', numeric: true },
      { key: 'versions', label: 'Tool versions' },
    ];
    return { caption, columns, rows: trendRows(figures) };
  }
  const type =
    valueOf(measure, measure.measure.metrics.find((m) => m.key === figures.metric)?.value ?? '')
      ?.type ?? 'number';
  const columns = [
    { key: 'resource', label: 'Resource' },
    { key: 'value', label: figures.name, numeric: true },
    { key: 'observed', label: 'Observed' },
  ];
  return { caption, columns, rows: metricRows(figures, type) };
}

function meets(value: ObservedValue | null, threshold: Threshold | undefined): string | null {
  if (threshold === undefined || typeof value !== 'number') return null;
  const ok =
    threshold.op === 'at_least' ? value >= threshold.threshold : value <= threshold.threshold;
  if (ok) return null;
  return `${threshold.op === 'at_least' ? 'Under' : 'Over'} ${String(threshold.threshold)}`;
}

function thresholdsOf(panel: Panel): readonly (Threshold | undefined)[] {
  return panel.kind === 'table' ? panel.values.map((column) => column.threshold) : [];
}

function valuesRows(panel: Panel, table: ValuesTable): PanelRow[] {
  const thresholds = thresholdsOf(panel);
  return table.rows.map((row) => {
    const cells = table.values.map((value, index): [string, Cell] => [
      `value.${value.key}`,
      {
        text: valueText(row.cells.at(index) ?? null, value.type, value.unit ?? null),
        held: meets(row.cells.at(index) ?? null, thresholds.at(index)),
      },
    ]);
    return {
      resource: plain(row.title),
      ...Object.fromEntries(cells),
      observed: observedCell(row.observedAt, row.reason),
    };
  });
}

function valuesTable(panel: Panel, table: ValuesTable): PanelTable {
  const columns = [
    { key: 'resource', label: 'Resource' },
    ...table.values.map((value) => ({
      key: `value.${value.key}`,
      label: value.name,
      numeric: value.type === 'number' || value.type === 'percent',
    })),
    { key: 'observed', label: 'Observed' },
  ];
  return { caption: 'Values by resource', columns, rows: valuesRows(panel, table) };
}

function statusTable(table: ValuesTable): PanelTable {
  const columns = [
    { key: 'resource', label: 'Resource' },
    { key: 'observed', label: 'Latest observation' },
  ];
  const rows = table.rows.map((row) => ({
    resource: plain(row.title),
    observed: observedCell(row.observedAt, row.reason),
  }));
  return { caption: 'Latest observation by resource', columns, rows };
}

export function panelTable(panel: Panel, data: PanelData, measure: MeasurePage): PanelTable {
  if (data.kind === 'metric') return metricTable(panel, data.figures, measure);
  if (data.kind === 'status') return statusTable(data.table);
  return valuesTable(panel, data.table);
}

export function csvCellText(cell: Cell | undefined): string {
  if (cell === undefined) return '';
  return cell.held === null ? cell.text : `${cell.text} (${cell.held})`;
}

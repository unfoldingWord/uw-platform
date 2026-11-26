import type { ChartLineage, ChartSpec } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { formatCount, formatFigure, formatMoney } from '@uw/core/money';
import type { ChartSeries, SpecChartDrawing } from '@uw/ui/components/spec-chart.tsx';
import { cellOf, type ChartCell, type ChartColumn, type ChartRow } from './queries.ts';

type Format = ChartSpec['format'];

const leftOutWords: ReadonlyMap<string, string> = new Map([
  ['creation_not_read', 'their creation was not in the history read'],
  ['history_capped', 'only the newest stage events were read'],
]);

const staleWords: ReadonlyMap<string, string> = new Map([
  ['source_behind', 'GitHub deliveries are waiting to be read, so the latest days may be short'],
  ['source_unreadable', 'the source could not be checked, so the latest days may be short'],
]);

function figureOf(format: Format): (value: number) => string {
  const { currency } = format;
  if (format.y === 'money' && currency !== null) {
    return (value) => formatMoney({ amountMinor: Math.round(value), currency });
  }
  if (format.y === 'days') return (value) => `${formatFigure(value)} d`;
  return formatCount;
}

export function notesOf(lineage: ChartLineage): readonly string[] {
  const stale = lineage.stale;
  const staleNote =
    stale === null
      ? []
      : [
          `Source ${stale.reason === 'source_behind' ? 'behind' : 'unreadable'} since ${formatInstant(new Date(stale.since))}: ${staleWords.get(stale.reason) ?? stale.reason}.`,
        ];
  const leftOut = lineage.excluded.reasons.map(
    (each) =>
      `${formatCount(each.count)} items left out: ${leftOutWords.get(each.reason) ?? each.reason}.`,
  );
  return [...staleNote, ...leftOut];
}

function text(cell: ChartCell | undefined): string {
  return cell === null || cell === undefined ? '' : String(cell);
}

function numberOf(cell: ChartCell | undefined): number | null {
  return typeof cell === 'number' ? cell : null;
}

function cellAt(row: ChartRow | undefined, key: string): ChartCell {
  return row === undefined ? null : cellOf(row, key);
}

function distinct(rows: readonly ChartRow[], key: string): readonly string[] {
  return [...new Set(rows.map((row) => text(cellOf(row, key))))];
}

function pivoted(spec: ChartSpec, rows: readonly ChartRow[], x: readonly string[]): ChartSeries[] {
  const series = spec.encodings.series ?? '';
  const y = spec.encodings.y[0] ?? '';
  return distinct(rows, series).map((name) => ({
    name,
    values: x.map((at) =>
      numberOf(
        cellAt(
          rows.find(
            (row) =>
              text(cellOf(row, spec.encodings.x)) === at && text(cellOf(row, series)) === name,
          ),
          y,
        ),
      ),
    ),
  }));
}

function byColumn(
  spec: ChartSpec,
  columns: readonly ChartColumn[],
  rows: readonly ChartRow[],
  x: readonly string[],
): ChartSeries[] {
  return spec.encodings.y.map((key) => ({
    name: columns.find((column) => column.key === key)?.label ?? key,
    values: x.map((at) =>
      numberOf(
        cellAt(
          rows.find((row) => text(cellOf(row, spec.encodings.x)) === at),
          key,
        ),
      ),
    ),
  }));
}

export function drawingOf(input: {
  readonly id: string;
  readonly spec: ChartSpec;
  readonly columns: readonly ChartColumn[];
  readonly rows: readonly ChartRow[];
  readonly notes: readonly string[];
}): SpecChartDrawing {
  const { spec, rows } = input;
  const categories = distinct(rows, spec.encodings.x);
  return {
    id: input.id,
    title: spec.title,
    type: spec.type,
    categories,
    series:
      spec.encodings.series === null
        ? byColumn(spec, input.columns, rows, categories)
        : pivoted(spec, rows, categories),
    figure: figureOf(spec.format),
    notes: input.notes,
  };
}

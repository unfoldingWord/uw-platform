import type { ChartExcludedEntry, ChartLineage, ChartSpec } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { formatCount, formatFigure, formatMoney } from '@uw/core/money';
import type { ChartSeries, SpecChartDrawing } from '@uw/ui/components/spec-chart.tsx';
import { graphOf } from './graph-drawing.ts';
import { cellOf, type ChartCell, type ChartColumn, type ChartRow } from './query-types.ts';

type Format = ChartSpec['format'];

const leftOutWords: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['creation_not_read', ['item', ': their creation was not in the history read']],
  ['history_capped', ['item', ': only the newest stage events were read']],
  ['ambiguous_name', ['entry', ', naming more than one person']],
  ['unresolved_name', ['entry', ', naming no one in the directory']],
  ['person_not_readable', ['entry', ', naming a person you cannot read']],
  ['page_not_readable', ['entry', ', naming a page you cannot read']],
  ['page_retired', ['entry', ', naming a retired page']],
]);

function leftOutLine(count: number, reason: string): string {
  const [noun, why] = leftOutWords.get(reason) ?? ['entry', `: ${reason}`];
  const plural = noun === 'entry' ? 'entries' : `${noun}s`;
  return `${formatCount(count)} ${count === 1 ? noun : plural} left out${why}.`;
}

function either(names: readonly string[]): string {
  if (names.length < 3) return names.join(' or ');
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`;
}

function quoted(named: string | null): string {
  return `“${named ?? ''}”`;
}

function entryNote(entry: ChartExcludedEntry): string {
  const { subject, named } = entry;
  if (entry.reason === 'ambiguous_name') {
    return `Left out, ambiguous: ${subject} named ${quoted(named)}, who could be ${either(entry.candidates)}.`;
  }
  if (entry.reason === 'unresolved_name') {
    return `Left out, unresolved: ${subject} named ${quoted(named)}, who matches no one in the directory.`;
  }
  if (entry.reason === 'page_retired') {
    return `Left out, retired: ${subject} on ${named ?? 'a page'}, which is retired.`;
  }
  return `Left out: ${subject} on a page you cannot read.`;
}

function countNotes(lineage: ChartLineage): string[] {
  const { reasons, entries } = lineage.excluded;
  return reasons.flatMap((each) => {
    const rest = each.count - entries.filter((entry) => entry.reason === each.reason).length;
    if (rest <= 0) return [];
    return [leftOutLine(rest, each.reason)];
  });
}

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
  if (format.y === 'percent') return (value) => `${formatFigure(value)}%`;
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
  return [...staleNote, ...lineage.excluded.entries.map(entryNote), ...countNotes(lineage)];
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
  const graph = spec.encodings.target === undefined ? {} : { graph: graphOf(spec, rows) };
  return {
    ...graph,
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

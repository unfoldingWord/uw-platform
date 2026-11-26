import type { ChartSpec } from '@uw/contracts';
import type { GraphDrawing, GraphNode } from '@uw/ui/components/graph-chart.ts';
import { cellOf, type ChartCell, type ChartRow } from './query-types.ts';

export const UNSPECIFIED = 'unspecified';

function text(cell: ChartCell): string {
  return cell === null ? '' : String(cell);
}

function percentLabel(cell: ChartCell): string {
  return typeof cell === 'number' ? `${cell}%` : UNSPECIFIED;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

function circleNodes(froms: readonly string[], tos: readonly string[]): GraphNode[] {
  return unique([...froms, ...tos])
    .sort(byName)
    .map((name) => ({ name, side: 'source', group: null }));
}

function columnNodes(spec: ChartSpec, rows: readonly ChartRow[], froms: readonly string[]) {
  const group = spec.encodings.group;
  const target = spec.encodings.target ?? '';
  const sources: GraphNode[] = unique(froms)
    .sort(byName)
    .map((name) => ({ name, side: 'source', group: null }));
  const seen = new Map<string, GraphNode>();
  for (const row of rows) {
    const name = text(cellOf(row, target));
    const inGroup = group === undefined ? null : text(cellOf(row, group));
    if (!seen.has(name)) seen.set(name, { name, side: 'target', group: inGroup });
  }
  const targets = [...seen.values()];
  const groups = unique(targets.flatMap((node) => (node.group === null ? [] : [node.group])));
  return { nodes: [...sources, ...targets], groups };
}

export function graphOf(spec: ChartSpec, rows: readonly ChartRow[]): GraphDrawing {
  const target = spec.encodings.target ?? '';
  const value = spec.encodings.y[0] ?? '';
  const labelled = spec.format.y === 'percent';
  const edges = rows.map((row) => ({
    from: text(cellOf(row, spec.encodings.x)),
    to: text(cellOf(row, target)),
    label: labelled ? percentLabel(cellOf(row, value)) : null,
  }));
  const froms = edges.map((edge) => edge.from);
  if (spec.type === 'graph') {
    const tos = edges.map((edge) => edge.to);
    return { layout: 'circle', nodes: circleNodes(froms, tos), edges, groups: [] };
  }
  return { layout: 'columns', edges, ...columnNodes(spec, rows, froms) };
}

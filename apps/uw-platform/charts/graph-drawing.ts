import type { ChartSpec } from '@uw/contracts';
import type { GraphDrawing, GraphEdge, GraphNode } from '@uw/ui/components/graph-chart.ts';
import { cellOf, type ChartCell, type ChartColumn, type ChartRow } from './query-types.ts';

export const UNSPECIFIED = 'unspecified';

type End = { readonly id: string; readonly name: string };
type Link = {
  readonly from: End;
  readonly to: End;
  readonly group: string | null;
  readonly label: string | null;
};

function text(cell: ChartCell): string {
  return cell === null ? '' : String(cell);
}

function percentLabel(cell: ChartCell): string {
  return typeof cell === 'number' ? `${cell}%` : UNSPECIFIED;
}

function byName(a: End, b: End): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function uniqueEnds(ends: readonly End[]): End[] {
  return [...new Map(ends.map((end) => [end.id, end])).values()];
}

function endOf(row: ChartRow, key: string, columns: readonly ChartColumn[]): End {
  const name = text(cellOf(row, key));
  const identity = columns.find((column) => column.key === key)?.identity;
  return { id: identity === undefined ? name : text(cellOf(row, identity)), name };
}

function nodesOf(ends: readonly End[], side: GraphNode['side']): GraphNode[] {
  return uniqueEnds(ends)
    .sort(byName)
    .map((end) => ({ ...end, side, group: null }));
}

function columnNodes(links: readonly Link[]) {
  const sources = nodesOf(
    links.map((link) => link.from),
    'source',
  );
  const seen = new Map<string, GraphNode>();
  for (const link of links) {
    if (!seen.has(link.to.id))
      seen.set(link.to.id, { ...link.to, side: 'target', group: link.group });
  }
  const targets = [...seen.values()];
  const groups = [...new Set(targets.flatMap((node) => (node.group === null ? [] : [node.group])))];
  return { nodes: [...sources, ...targets], groups };
}

export function graphOf(
  spec: ChartSpec,
  columns: readonly ChartColumn[],
  rows: readonly ChartRow[],
): GraphDrawing {
  const { x, group } = spec.encodings;
  const target = spec.encodings.target ?? '';
  const value = spec.encodings.y[0] ?? '';
  const labelled = spec.format.y === 'percent';
  const links: Link[] = rows.map((row) => ({
    from: endOf(row, x, columns),
    to: endOf(row, target, columns),
    group: group === undefined ? null : text(cellOf(row, group)),
    label: labelled ? percentLabel(cellOf(row, value)) : null,
  }));
  const edges: GraphEdge[] = links.map((link) => ({
    from: link.from.id,
    to: link.to.id,
    label: link.label,
  }));
  if (spec.type === 'graph') {
    const ends = links.flatMap((link) => [link.from, link.to]);
    return { layout: 'circle', nodes: nodesOf(ends, 'source'), edges, groups: [] };
  }
  return { layout: 'columns', edges, ...columnNodes(links) };
}

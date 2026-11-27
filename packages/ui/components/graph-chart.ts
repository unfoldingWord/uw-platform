import { GraphChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import { use, type EChartsCoreOption } from 'echarts/core';
import { seriesRoles, tokenColour } from './chart.tsx';

use([GraphChart, LegendComponent]);

export type GraphNode = {
  readonly id: string;
  readonly name: string;
  readonly side: 'source' | 'target';
  readonly group: string | null;
};

export type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
};

export type GraphDrawing = {
  readonly layout: 'circle' | 'columns';
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly groups: readonly string[];
};

type Placed = { readonly node: GraphNode; readonly x: number; readonly y: number };
type Plot = { readonly placed: readonly Placed[]; readonly box: Box; readonly height: number };
type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

const WIDTH = 760;
const ROW = 30;
const GROUP_GAP = 14;
const LEGEND_ROOM = 36;
const RADIUS = 170;
const SOURCE_X = 190;
const TARGET_X = 450;

function nodeId(node: GraphNode): string {
  return `${node.side}:${node.id}`;
}

function circlePlot(nodes: readonly GraphNode[]): Plot {
  const centre = { x: WIDTH / 2, y: RADIUS + LEGEND_ROOM };
  const placed = nodes.map((node, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(nodes.length, 1);
    const x = centre.x + RADIUS * Math.cos(angle);
    const y = centre.y + RADIUS * Math.sin(angle);
    return { node, x: Math.round(x), y: Math.round(y) };
  });
  const box = { left: centre.x - RADIUS, top: LEGEND_ROOM, width: 2 * RADIUS, height: 2 * RADIUS };
  return { placed, box, height: box.top + box.height + LEGEND_ROOM };
}

function column(nodes: readonly GraphNode[], x: number): Placed[] {
  let y = LEGEND_ROOM;
  let group: string | null | undefined;
  return nodes.map((node) => {
    if (group !== undefined && node.group !== group) y += GROUP_GAP;
    group = node.group;
    const placed = { node, x, y };
    y += ROW;
    return placed;
  });
}

function columnsPlot(nodes: readonly GraphNode[]): Plot {
  const sources = column(
    nodes.filter((node) => node.side === 'source'),
    SOURCE_X,
  );
  const targets = column(
    nodes.filter((node) => node.side === 'target'),
    TARGET_X,
  );
  const bottom = Math.max(LEGEND_ROOM + ROW, ...[...sources, ...targets].map((at) => at.y));
  const box = {
    left: SOURCE_X,
    top: LEGEND_ROOM,
    width: TARGET_X - SOURCE_X,
    height: bottom - LEGEND_ROOM,
  };
  return { placed: [...sources, ...targets], box, height: bottom + LEGEND_ROOM };
}

function labelSide(drawing: GraphDrawing, at: Placed): string {
  if (drawing.layout === 'columns') return at.node.side === 'source' ? 'left' : 'right';
  return at.x < WIDTH / 2 - 1 ? 'left' : 'right';
}

function anchors(box: Box) {
  const hidden = { symbolSize: 0, label: { show: false }, itemStyle: { color: 'none' } };
  return [
    { name: 'anchor:start', x: box.left, y: box.top, ...hidden },
    { name: 'anchor:end', x: box.left + box.width, y: box.top + box.height, ...hidden },
  ];
}

function categoryOf(drawing: GraphDrawing, node: GraphNode): number {
  return node.group === null ? 0 : Math.max(0, drawing.groups.indexOf(node.group));
}

function nodeData(drawing: GraphDrawing, plot: Plot) {
  return plot.placed.map((at) => ({
    id: nodeId(at.node),
    name: at.node.name,
    x: at.x,
    y: at.y,
    category: categoryOf(drawing, at.node),
    ...(at.node.side === 'source' && drawing.layout === 'columns'
      ? { itemStyle: { color: tokenColour('text-2') } }
      : {}),
    label: { show: true, position: labelSide(drawing, at) },
  }));
}

function categories(drawing: GraphDrawing) {
  const names = drawing.groups.length === 0 ? ['People'] : drawing.groups;
  return names.map((name, index) => ({
    name,
    itemStyle: { color: tokenColour(seriesRoles[index % seriesRoles.length] ?? 'series-1') },
  }));
}

type EdgeParams = { readonly data?: { readonly label?: unknown } };

function edgeData(drawing: GraphDrawing) {
  const toSide = drawing.layout === 'columns' ? 'target' : 'source';
  return drawing.edges.map((edge) => ({
    source: `source:${edge.from}`,
    target: `${toSide}:${edge.to}`,
    label: edge.label,
  }));
}

export function graphOption(drawing: GraphDrawing, notesRoom: number) {
  const plot = drawing.layout === 'circle' ? circlePlot(drawing.nodes) : columnsPlot(drawing.nodes);
  const option: EChartsCoreOption = {
    animation: false,
    legend: {
      show: drawing.groups.length > 0,
      top: 0,
      left: 0,
      backgroundColor: 'none',
      textStyle: { color: tokenColour('text-2'), fontSize: 12 },
      data: [...drawing.groups],
    },
    series: [
      {
        type: 'graph',
        layout: 'none',
        roam: false,
        ...plot.box,
        symbolSize: 12,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 10,
        categories: categories(drawing),
        label: { color: tokenColour('text-2'), fontSize: 13 },
        lineStyle: { color: tokenColour('text-3'), width: 1.5, opacity: 1, curveness: 0.08 },
        edgeLabel: {
          show: drawing.edges.some((edge) => edge.label !== null),
          fontSize: 12,
          color: tokenColour('text-2'),
          textBorderWidth: 0,
          formatter: (params: EdgeParams) =>
            typeof params.data?.label === 'string' ? params.data.label : '',
        },
        data: [...nodeData(drawing, plot), ...anchors(plot.box)],
        links: edgeData(drawing),
      },
    ],
  };
  return { option, width: WIDTH, height: plot.height + notesRoom };
}

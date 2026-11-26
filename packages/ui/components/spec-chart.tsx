import { LegendComponent } from 'echarts/components';
import { use, type EChartsCoreOption } from 'echarts/core';
import { raw } from 'hono/html';
import { forStrictCsp, renderSvg, seriesRoles, tokenColour } from './chart.tsx';

use([LegendComponent]);

export type ChartSeries = { readonly name: string; readonly values: readonly (number | null)[] };

export type SpecChartDrawing = {
  readonly id: string;
  readonly title: string;
  readonly type: 'bar' | 'line' | 'stacked_area';
  readonly categories: readonly string[];
  readonly series: readonly ChartSeries[];
  readonly figure: (value: number) => string;
  readonly notes: readonly string[];
};

const WIDTH = 1080;
const HEIGHT = 280;
const NOTE_LINE = 18;
const LEGEND_ROOM = 28;
const dashes = ['solid', 'dashed', 'dotted'] as const;
const symbols = ['circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin'] as const;
const axisLabel = { color: tokenColour('text-3'), fontSize: 12 };

type LabelParams = { readonly value?: unknown };

function at<T>(list: readonly T[], index: number, fallback: T): T {
  return list.at(index % list.length) ?? fallback;
}

function figureLabel(drawing: SpecChartDrawing, position: string) {
  return {
    show: true,
    position,
    fontSize: 11,
    color: tokenColour('text-2'),
    formatter: (params: LabelParams) =>
      typeof params.value === 'number' ? drawing.figure(params.value) : '',
  };
}

function seriesOption(drawing: SpecChartDrawing, series: ChartSeries, index: number) {
  const color = tokenColour(at(seriesRoles, index, 'series-1'));
  const data = [...series.values];
  if (drawing.type === 'bar') {
    return {
      type: 'bar',
      name: series.name,
      data,
      itemStyle: { color, borderRadius: [2, 2, 0, 0] },
      barMaxWidth: 24,
      label: figureLabel(drawing, 'top'),
    };
  }
  const stacked = drawing.type === 'stacked_area';
  return {
    type: 'line',
    name: series.name,
    data,
    connectNulls: false,
    showSymbol: true,
    symbol: at(symbols, index, 'circle'),
    symbolSize: 6,
    itemStyle: { color },
    lineStyle: { width: 2, color, type: at(dashes, index, 'solid') },
    ...(stacked ? { stack: 'total', areaStyle: { color, opacity: 0.8 } } : {}),
    label: figureLabel(drawing, stacked ? 'inside' : 'top'),
  };
}

function legendOf(drawing: SpecChartDrawing) {
  if (drawing.series.length < 2) return { show: false };
  return {
    show: true,
    top: 0,
    left: 0,
    backgroundColor: 'none',
    textStyle: { color: tokenColour('text-2'), fontSize: 12 },
    data: drawing.series.map((series) => series.name),
  };
}

function optionOf(drawing: SpecChartDrawing): EChartsCoreOption {
  const top = drawing.series.length < 2 ? 20 : 20 + LEGEND_ROOM;
  return {
    animation: false,
    legend: legendOf(drawing),
    grid: { left: 56, right: 24, top, bottom: 28 + NOTE_LINE * drawing.notes.length },
    xAxis: {
      type: 'category',
      data: [...drawing.categories],
      boundaryGap: drawing.type === 'bar',
      axisLine: { lineStyle: { color: tokenColour('line') } },
      axisLabel: { ...axisLabel, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      splitLine: { lineStyle: { color: tokenColour('line') } },
      axisLabel: { ...axisLabel, formatter: (value: number) => drawing.figure(value) },
    },
    series: drawing.series.map((series, index) => seriesOption(drawing, series, index)),
  };
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function noteLines(drawing: SpecChartDrawing, height: number): string {
  const first = height - NOTE_LINE * drawing.notes.length + 12;
  return drawing.notes
    .map(
      (note, index) =>
        `<text x="8" y="${first + NOTE_LINE * index}" class="text-xs fill-text-2">${escapeText(note)}</text>`,
    )
    .join('');
}

export function specChartSvg(drawing: SpecChartDrawing): string {
  const height = HEIGHT + NOTE_LINE * drawing.notes.length;
  const svg = forStrictCsp(renderSvg(optionOf(drawing), WIDTH, height), drawing.id, drawing.title);
  const opened = svg.indexOf('>') + 1;
  const titled = `${svg.slice(0, opened)}<title>${escapeText(drawing.title)}</title>${svg.slice(opened)}`;
  return titled.replace(/<\/svg>$/, `${noteLines(drawing, height)}</svg>`);
}

export function SpecChart(props: SpecChartDrawing) {
  return <div class="overflow-x-auto">{raw(specChartSvg(props))}</div>;
}

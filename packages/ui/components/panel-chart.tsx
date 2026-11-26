import { MarkLineComponent } from 'echarts/components';
import { use, type EChartsCoreOption } from 'echarts/core';
import { raw } from 'hono/html';
import { forStrictCsp, renderSvg, tokenColour } from './chart.tsx';

use([MarkLineComponent]);

export type BarsSeries = {
  readonly id: string;
  readonly label: string;
  readonly names: readonly string[];
  readonly values: readonly number[];
  readonly target: number | null;
  readonly targetLabel: string;
};

export type TrendSeries = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
};

const BAR_ROW = 28;
const BARS_FRAME = 48;
const BARS_WIDTH = 480;
const axisLabel = { color: tokenColour('text-3'), fontSize: 12 };

function targetLine(series: BarsSeries) {
  if (series.target === null) return {};
  return {
    markLine: {
      symbol: 'none',
      silent: true,
      data: [{ xAxis: series.target }],
      lineStyle: { type: 'dashed', width: 2, color: tokenColour('text-2') },
      label: { formatter: series.targetLabel, color: tokenColour('text-2'), position: 'end' },
    },
  };
}

function barsOption(series: BarsSeries): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 8, right: 56, top: 24, bottom: 24, containLabel: true },
    yAxis: {
      type: 'category',
      inverse: true,
      data: [...series.names],
      axisLine: { lineStyle: { color: tokenColour('line') } },
      axisLabel,
      axisTick: { show: false },
    },
    xAxis: {
      type: 'value',
      min: 0,
      splitLine: { lineStyle: { color: tokenColour('line') } },
      axisLabel,
    },
    series: [
      {
        type: 'bar',
        data: [...series.values],
        itemStyle: { color: tokenColour('accent'), borderRadius: [0, 2, 2, 0] },
        barMaxWidth: 18,
        ...targetLine(series),
      },
    ],
  };
}

export function barsChartSvg(series: BarsSeries): string {
  const height = BARS_FRAME + BAR_ROW * Math.max(series.names.length, 1);
  return forStrictCsp(renderSvg(barsOption(series), BARS_WIDTH, height), series.id, series.label);
}

function trendOption(series: TrendSeries): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 4, bottom: 4 },
    xAxis: { type: 'category', show: false, data: series.values.map((_value, index) => index) },
    yAxis: { type: 'value', show: false, min: 0 },
    series: [
      {
        type: 'line',
        data: [...series.values],
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 4,
        itemStyle: { color: tokenColour('accent') },
        lineStyle: { width: 2, color: tokenColour('accent') },
      },
    ],
  };
}

export function trendLineSvg(series: TrendSeries): string {
  return forStrictCsp(renderSvg(trendOption(series), 240, 40), series.id, series.label);
}

export function BarsChart(props: BarsSeries) {
  return <div class="overflow-x-auto">{raw(barsChartSvg(props))}</div>;
}

export function TrendLine(props: TrendSeries) {
  return <div class="overflow-x-auto">{raw(trendLineSvg(props))}</div>;
}

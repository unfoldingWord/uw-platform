import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent } from 'echarts/components';
import { init, use, type EChartsCoreOption } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { raw } from 'hono/html';

use([BarChart, LineChart, GridComponent, SVGRenderer]);

const tokenClasses: Readonly<Record<string, { readonly fill: string; readonly stroke: string }>> = {
  'token-accent': { fill: 'fill-accent', stroke: 'stroke-accent' },
  'token-text-2': { fill: 'fill-text-2', stroke: 'stroke-text-2' },
  'token-text-3': { fill: 'fill-text-3', stroke: 'stroke-text-3' },
  'token-line': { fill: 'fill-line', stroke: 'stroke-line' },
};

const tokenClassFor = new Map(Object.entries(tokenClasses));

const tokenColour = (role: 'accent' | 'text-2' | 'text-3' | 'line'): string => `token-${role}`;

const styleElement = /<style\b[^>]*>[\s\S]*?<\/style>/g;
const tag = /<([a-zA-Z]+)\b([^>]*?)(\/?)>/g;
const attribute = /\s([\w:-]+)="([^"]*)"/g;

type Verdict = { readonly drop: true } | { readonly className: string } | { readonly keep: string };

const paints = new Set(['fill', 'stroke']);

function dropped(element: string, key: string, value: string): boolean {
  if (key === 'style' || key === 'class' || key.startsWith('ecmeta_')) return true;
  if (paints.has(key) && value.startsWith('#')) return true;
  return element === 'svg' && (key === 'width' || key === 'height');
}

function verdict(element: string, key: string, value: string): Verdict {
  const role = paints.has(key) ? tokenClassFor.get(value) : undefined;
  if (role !== undefined) return { className: key === 'fill' ? role.fill : role.stroke };
  return dropped(element, key, value) ? { drop: true } : { keep: value };
}

function rewriteAttributes(element: string, attributes: string, id: string): string {
  const classes: string[] = element === 'text' ? ['text-xs'] : [];
  const kept: string[] = [];
  for (const [, key = '', value = ''] of attributes.matchAll(attribute)) {
    const decided = verdict(element, key, value);
    if ('className' in decided) classes.push(decided.className);
    if ('keep' in decided) kept.push(` ${key}="${decided.keep.replace(/zr\d+-/g, `${id}-`)}"`);
  }
  if (element === 'svg') classes.push('block', 'h-auto', 'w-full');
  const classAttribute = classes.length === 0 ? '' : ` class="${classes.join(' ')}"`;
  return `${kept.join('')}${classAttribute}`;
}

export function forStrictCsp(svg: string, id: string, label: string): string {
  const cleaned = svg
    .replace(styleElement, '')
    .replace(tag, (_match, name: string, attributes: string, selfClosing: string) => {
      const rest = rewriteAttributes(name, attributes, id);
      const naming = name === 'svg' ? ` role="img" aria-label="${escapeAttribute(label)}"` : '';
      return `<${name}${rest}${naming}${selfClosing}>`;
    });
  return cleaned.replace(/\n+/g, '');
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderSvg(option: EChartsCoreOption, width: number, height: number): string {
  const chart = init(null, null, { renderer: 'svg', ssr: true, width, height });
  chart.setOption(option);
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

export type DailySeries = {
  readonly id: string;
  readonly label: string;
  readonly days: readonly string[];
  readonly bars: readonly number[];
  readonly line?: readonly number[];
};

const axisLabel = { color: tokenColour('text-3'), fontSize: 12 };

function dailyOption(series: DailySeries): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 40, right: 16, top: 12, bottom: 28 },
    xAxis: {
      type: 'category',
      data: [...series.days],
      axisLine: { lineStyle: { color: tokenColour('line') } },
      axisLabel: { ...axisLabel, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: tokenColour('line') } },
      axisLabel,
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: [...series.bars],
        itemStyle: { color: tokenColour('accent'), borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 18,
      },
      ...(series.line === undefined
        ? []
        : [
            {
              type: 'line',
              data: [...series.line],
              showSymbol: false,
              lineStyle: { width: 2, color: tokenColour('text-2') },
            },
          ]),
    ],
  };
}

export function dailyChartSvg(series: DailySeries): string {
  return forStrictCsp(renderSvg(dailyOption(series), 1080, 220), series.id, series.label);
}

export type Spark = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
};

function sparkOption(spark: Spark): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: 'category', show: false, data: spark.values.map((_value, index) => index) },
    yAxis: { type: 'value', show: false, min: 'dataMin' },
    series: [
      {
        type: 'line',
        data: [...spark.values],
        showSymbol: false,
        lineStyle: { width: 2, color: tokenColour('accent') },
      },
    ],
  };
}

export function sparklineSvg(spark: Spark): string {
  return forStrictCsp(renderSvg(sparkOption(spark), 120, 32), spark.id, spark.label);
}

export function DailyChart(props: DailySeries) {
  return <div class="overflow-x-auto">{raw(dailyChartSvg(props))}</div>;
}

export function Sparkline(props: Spark) {
  return <div class="overflow-x-auto">{raw(sparklineSvg(props))}</div>;
}

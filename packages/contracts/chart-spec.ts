import { z } from 'zod';

export const chartTypeSchema = z.enum(['bar', 'line', 'stacked_area']);
export const chartQueryKeySchema = z.enum([
  'daily_runs_and_waits',
  'item_cumulative_flow',
  'item_cycle_time',
  'item_burndown',
]);
export const standardChartKeySchema = z.enum([
  'runs_over_time',
  'waits_over_time',
  'cumulative_flow',
  'cycle_time',
  'burndown',
]);
export const chartAxisFormatSchema = z.enum(['date', 'text']);
export const chartValueFormatSchema = z.enum(['count', 'days', 'money']);
export const chartStaleReasonSchema = z.enum(['source_behind', 'source_unreadable']);
export const chartExcludedReasonSchema = z.enum(['creation_not_read', 'history_capped']);

const columnKey = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/)
  .max(40);
const currency = z.string().regex(/^[A-Z]{3}$/);
const json = z.record(z.string(), z.json());

export const chartHarnessParamsSchema = z.strictObject({ harnessId: z.uuid() });

export const chartQueryParamsSchemas = {
  daily_runs_and_waits: chartHarnessParamsSchema,
  item_cumulative_flow: chartHarnessParamsSchema,
  item_cycle_time: chartHarnessParamsSchema,
  item_burndown: chartHarnessParamsSchema,
} as const satisfies Record<z.infer<typeof chartQueryKeySchema>, z.ZodType>;

const formatSchema = z
  .strictObject({
    x: chartAxisFormatSchema,
    y: chartValueFormatSchema,
    currency: currency.nullable(),
  })
  .refine((format) => (format.y === 'money') === (format.currency !== null), {
    message: 'money names its currency, and nothing else does',
    path: ['currency'],
  });

export const chartSpecSchema = z.strictObject({
  title: z.string().min(1).max(120),
  type: chartTypeSchema,
  query: z.strictObject({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(60),
    params: json,
  }),
  encodings: z.strictObject({
    x: columnKey,
    y: z.array(columnKey).min(1).max(6),
    series: columnKey.nullable(),
  }),
  format: formatSchema,
});

const excludedSchema = z
  .strictObject({
    count: z.number().int().min(0),
    reasons: z
      .array(z.strictObject({ reason: chartExcludedReasonSchema, count: z.number().int().min(1) }))
      .max(10),
  })
  .refine(
    (excluded) => excluded.reasons.reduce((sum, each) => sum + each.count, 0) === excluded.count,
    {
      message: 'the reasons add up to the count left out',
    },
  );

export const chartLineageSchema = z.strictObject({
  source: z.string().min(1).max(200),
  query: chartQueryKeySchema,
  asOf: z.iso.datetime(),
  filters: z.record(z.string(), z.string().max(200)),
  excluded: excludedSchema,
  stale: z.strictObject({ since: z.iso.datetime(), reason: chartStaleReasonSchema }).nullable(),
});

const cellSchema = z.union([z.string().max(200), z.number(), z.null()]);

export const chartTableSchema = z.strictObject({
  columns: z.array(z.strictObject({ key: columnKey, label: z.string().min(1).max(80) })).max(12),
  rows: z.array(z.record(z.string(), cellSchema)).max(5000),
});

export const renderedChartSchema = z.strictObject({
  svg: z.string().min(1).max(2_000_000),
  table: chartTableSchema,
  lineage: chartLineageSchema,
});

export const renderChartInputSchema = z
  .strictObject({
    chart: standardChartKeySchema
      .nullable()
      .describe('A standard chart by key; give its parameters in params, and spec null'),
    params: json.describe('The parameters of the standard chart, such as {"harnessId": "<uuid>"}'),
    spec: chartSpecSchema
      .nullable()
      .describe('A chart spec over a whitelisted query; give chart null when you give one'),
  })
  .refine((input) => (input.chart === null) !== (input.spec === null), {
    message: 'give a standard chart or a spec, exactly one',
  });

export type ChartType = z.infer<typeof chartTypeSchema>;
export type ChartQueryKey = z.infer<typeof chartQueryKeySchema>;
export type StandardChartKey = z.infer<typeof standardChartKeySchema>;
export type ChartValueFormat = z.infer<typeof chartValueFormatSchema>;
export type ChartStaleReason = z.infer<typeof chartStaleReasonSchema>;
export type ChartExcludedReason = z.infer<typeof chartExcludedReasonSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type ChartLineage = z.infer<typeof chartLineageSchema>;
export type ChartTable = z.infer<typeof chartTableSchema>;
export type RenderedChart = z.infer<typeof renderedChartSchema>;
export type RenderChartInput = z.infer<typeof renderChartInputSchema>;

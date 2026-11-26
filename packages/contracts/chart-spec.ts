import { z } from 'zod';

export const chartTypeSchema = z.enum(['bar', 'line', 'stacked_area', 'graph', 'bipartite']);
export const chartQueryKeySchema = z.enum([
  'daily_runs_and_waits',
  'item_cumulative_flow',
  'item_cycle_time',
  'item_burndown',
  'team_commitments',
  'staff_allocations',
  'people_by_portfolio',
]);
export const standardChartKeySchema = z.enum([
  'runs_over_time',
  'waits_over_time',
  'cumulative_flow',
  'cycle_time',
  'burndown',
  'commitments_network',
  'staff_allocation',
  'people_and_portfolios',
]);
export const chartAxisFormatSchema = z.enum(['date', 'text']);
export const chartValueFormatSchema = z.enum(['count', 'days', 'money', 'percent']);
export const chartStaleReasonSchema = z.enum(['source_behind', 'source_unreadable']);
export const chartExcludedReasonSchema = z.enum([
  'creation_not_read',
  'history_capped',
  'ambiguous_name',
  'unresolved_name',
  'person_not_readable',
  'page_not_readable',
  'page_retired',
]);

const columnKey = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/)
  .max(40);
const currency = z.string().regex(/^[A-Z]{3}$/);
const json = z.record(z.string(), z.json());

export const chartHarnessParamsSchema = z.strictObject({ harnessId: z.uuid() });
export const chartNoParamsSchema = z.strictObject({});

export const chartQueryParamsSchemas = {
  daily_runs_and_waits: chartHarnessParamsSchema,
  item_cumulative_flow: chartHarnessParamsSchema,
  item_cycle_time: chartHarnessParamsSchema,
  item_burndown: chartHarnessParamsSchema,
  team_commitments: chartNoParamsSchema,
  staff_allocations: chartNoParamsSchema,
  people_by_portfolio: chartNoParamsSchema,
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

const graphTypes: ReadonlySet<string> = new Set(['graph', 'bipartite']);

export const chartSpecSchema = z
  .strictObject({
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
      target: columnKey.optional(),
      group: columnKey.optional(),
    }),
    format: formatSchema,
  })
  .refine((spec) => graphTypes.has(spec.type) === (spec.encodings.target !== undefined), {
    message: 'a graph names the column its edges point to, and nothing else does',
    path: ['encodings', 'target'],
  })
  .refine((spec) => spec.type === 'bipartite' || spec.encodings.group === undefined, {
    message: 'only a two-column graph groups its targets',
    path: ['encodings', 'group'],
  });

const entrySchema = z.strictObject({
  reason: chartExcludedReasonSchema,
  subject: z.string().min(1).max(200),
  named: z.string().max(200).nullable(),
  candidates: z.array(z.string().min(1).max(200)).max(20),
});

type Excluded = {
  readonly count: number;
  readonly reasons: readonly { readonly reason: string; readonly count: number }[];
  readonly entries: readonly { readonly reason: string }[];
};

function entriesWithinCounts(excluded: Excluded): boolean {
  return (
    excluded.reasons.every(
      (each) =>
        excluded.entries.filter((entry) => entry.reason === each.reason).length <= each.count,
    ) &&
    excluded.entries.every((entry) => excluded.reasons.some((each) => each.reason === entry.reason))
  );
}

const excludedSchema = z
  .strictObject({
    count: z.number().int().min(0),
    reasons: z
      .array(z.strictObject({ reason: chartExcludedReasonSchema, count: z.number().int().min(1) }))
      .max(10),
    entries: z.array(entrySchema).max(500),
  })
  .refine(
    (excluded) => excluded.reasons.reduce((sum, each) => sum + each.count, 0) === excluded.count,
    {
      message: 'the reasons add up to the count left out',
    },
  )
  .refine(entriesWithinCounts, {
    message: 'each entry left out is counted under its reason',
    path: ['entries'],
  });

export const chartLineageSchema = z.strictObject({
  source: z.string().min(1).max(200),
  query: chartQueryKeySchema,
  asOf: z.iso.datetime(),
  filters: z.record(z.string(), z.string().max(200)),
  excluded: excludedSchema,
  stale: z.strictObject({ since: z.iso.datetime(), reason: chartStaleReasonSchema }).nullable(),
});

const cellSchema = z.union([z.string().max(4000), z.number(), z.null()]);

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
export type ChartExcludedEntry = z.infer<typeof entrySchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type ChartLineage = z.infer<typeof chartLineageSchema>;
export type ChartTable = z.infer<typeof chartTableSchema>;
export type RenderedChart = z.infer<typeof renderedChartSchema>;
export type RenderChartInput = z.infer<typeof renderChartInputSchema>;

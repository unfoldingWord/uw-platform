import type { ZodType } from 'zod';
import {
  chartAxisFormatSchema,
  chartExcludedReasonSchema,
  chartHarnessParamsSchema,
  chartLineageSchema,
  chartQueryKeySchema,
  chartSpecSchema,
  chartStaleReasonSchema,
  chartTableSchema,
  chartTypeSchema,
  chartValueFormatSchema,
  renderChartInputSchema,
  renderedChartSchema,
  standardChartKeySchema,
} from './chart-spec.ts';

export const chartSchemaRegistry: Record<string, ZodType> = {
  'chart-type': chartTypeSchema,
  'chart-query-key': chartQueryKeySchema,
  'standard-chart-key': standardChartKeySchema,
  'chart-axis-format': chartAxisFormatSchema,
  'chart-value-format': chartValueFormatSchema,
  'chart-stale-reason': chartStaleReasonSchema,
  'chart-excluded-reason': chartExcludedReasonSchema,
  'chart-harness-params': chartHarnessParamsSchema,
  'chart-spec': chartSpecSchema,
  'chart-lineage': chartLineageSchema,
  'chart-table': chartTableSchema,
  'rendered-chart': renderedChartSchema,
  'render-chart-input': renderChartInputSchema,
};

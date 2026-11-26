import { z } from 'zod';
import { thresholdSchema, valueKeySchema } from './measures.ts';

export const resourceKinds = ['website', 'mobile_app'] as const;
export const panelKinds = ['figure', 'bars', 'table', 'trend', 'list', 'status'] as const;

export const resourceKindSchema = z.enum(resourceKinds);
export const panelKindSchema = z.enum(panelKinds);

const distinct = (values: readonly string[]) => new Set(values).size === values.length;

const organizationContext = z.strictObject({
  kind: z.literal('organization'),
  resource_kind: resourceKindSchema,
});
const pageContext = z.strictObject({
  kind: z.literal('page'),
  page_id: z.uuid(),
  descendants: z.boolean(),
});
const resourcesContext = z.strictObject({
  kind: z.literal('resources'),
  resource_ids: z.array(z.uuid()).min(1).max(200).refine(distinct, 'each resource once'),
});
const hostContext = z.strictObject({ kind: z.literal('host'), descendants: z.boolean() });

export const dashboardContextSchema = z.discriminatedUnion('kind', [
  organizationContext,
  pageContext,
  resourcesContext,
  hostContext,
]);

export const metricContextSchema = z.discriminatedUnion('kind', [
  organizationContext,
  pageContext,
  resourcesContext,
]);

export const dashboardFrontmatterSchema = z.strictObject({ context: dashboardContextSchema });

const title = z
  .string()
  .max(120)
  .refine((value) => value.trim().length > 0, 'a title is not blank')
  .optional();

const onMetric = { measure: z.uuid(), metric: valueKeySchema, title };

const tableColumn = z.strictObject({
  value: valueKeySchema,
  threshold: thresholdSchema.optional(),
});

export const panelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('figure'), ...onMetric }),
  z.strictObject({ kind: z.literal('bars'), ...onMetric }),
  z.strictObject({
    kind: z.literal('table'),
    measure: z.uuid(),
    values: z
      .array(tableColumn)
      .min(1)
      .max(12)
      .refine((columns) => distinct(columns.map((column) => column.value)), 'each value once'),
    title,
  }),
  z.strictObject({ kind: z.literal('trend'), ...onMetric }),
  z.strictObject({ kind: z.literal('list'), measure: z.uuid(), value: valueKeySchema, title }),
  z.strictObject({ kind: z.literal('status'), measure: z.uuid(), title }),
]);

export type ResourceKind = z.infer<typeof resourceKindSchema>;
export type PanelKind = z.infer<typeof panelKindSchema>;
export type DashboardContext = z.infer<typeof dashboardContextSchema>;
export type MetricContext = z.infer<typeof metricContextSchema>;
export type DashboardFrontmatter = z.infer<typeof dashboardFrontmatterSchema>;
export type Panel = z.infer<typeof panelSchema>;

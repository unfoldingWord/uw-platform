import { z } from 'zod';
import { collectionKeySchema, propertyKeySchema } from './collections.ts';
import { filterGroupSchema, rowGroupingSchema, rowSortSchema } from './collection-query.ts';

export const layoutSchema = z.enum(['table', 'board', 'list', 'gallery', 'calendar', 'chart']);
export const viewScopeSchema = z.enum(['shared', 'personal']);
export const chartKindSchema = z.enum(['bar', 'donut']);

const name = z
  .string()
  .max(80)
  .refine((value) => value.trim().length > 0, 'a name is not blank');

export const groupValueSchema = z.string().min(1).max(80);

export const viewPropertySchema = z.strictObject({
  property: propertyKeySchema,
  visible: z.boolean(),
  width: z.number().int().min(60).max(800).nullable().default(null),
});

export const viewGroupSchema = z.strictObject({
  value: groupValueSchema,
  visible: z.boolean().default(true),
  wipLimit: z.number().int().min(1).max(500).nullable().default(null),
});

export const chartSchema = z.strictObject({
  kind: chartKindSchema,
  sum: propertyKeySchema.nullable().default(null),
});

const distinct = (values: readonly string[]) => new Set(values).size === values.length;

export const viewSettingsSchema = z
  .strictObject({
    name,
    layout: layoutSchema,
    scope: viewScopeSchema,
    properties: z.array(viewPropertySchema).max(100).default([]),
    filter: filterGroupSchema.nullable().default(null),
    sorts: z.array(rowSortSchema).max(5).default([]),
    group: rowGroupingSchema.nullable().default(null),
    groups: z.array(viewGroupSchema).max(200).default([]),
    hideEmptyGroups: z.boolean().default(false),
    manualOrder: z.boolean().default(false),
    dateProperty: propertyKeySchema.nullable().default(null),
    chart: chartSchema.nullable().default(null),
    cover: z.boolean().default(false),
    defaultTemplate: z.uuid().nullable().default(null),
  })
  .refine((v) => distinct(v.properties.map((p) => p.property)), 'each property once')
  .refine((v) => distinct(v.groups.map((g) => g.value)), 'each group once')
  .refine((v) => v.layout !== 'board' || v.group !== null, 'a board is grouped')
  .refine(
    (v) => v.layout !== 'chart' || (v.group !== null && v.chart !== null),
    'a chart is grouped',
  )
  .refine((v) => v.layout !== 'calendar' || v.dateProperty !== null, 'a calendar names its date');

export const savedViewSchema = z.strictObject({
  id: z.uuid(),
  collection: collectionKeySchema,
  position: z.number().int().min(0),
  ownerId: z.uuid().nullable(),
  settings: viewSettingsSchema,
});

export type Layout = z.infer<typeof layoutSchema>;
export type ViewScope = z.infer<typeof viewScopeSchema>;
export type ViewProperty = z.infer<typeof viewPropertySchema>;
export type ViewGroup = z.infer<typeof viewGroupSchema>;
export type ViewSettings = z.infer<typeof viewSettingsSchema>;
export type SavedView = z.infer<typeof savedViewSchema>;

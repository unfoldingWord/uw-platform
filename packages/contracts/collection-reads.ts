import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import {
  collectionDefinitionSchema,
  collectionKeySchema,
  propertyKeySchema,
  propertyTypeSchema,
  readThroughFeedSchema,
} from './collections.ts';
import { layoutSchema, savedViewSchema, viewScopeSchema } from './collection-views.ts';

export const readThroughStateSchema = z.enum(['not_wired', 'no_budget_lines', 'no_value']);

export const readThroughValueSchema = z.strictObject({
  feed: readThroughFeedSchema,
  state: readThroughStateSchema,
});

export const viewSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  layout: layoutSchema,
  scope: viewScopeSchema,
});

export const templateSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
});

export const collectionSummarySchema = z.strictObject({
  key: collectionKeySchema,
  name: z.string().min(1).max(80),
  jdArea: jdAreaSchema,
  version: z.number().int().min(1),
  locked: z.boolean(),
});

export const collectionReplySchema = z.strictObject({
  collection: collectionSummarySchema,
  definition: collectionDefinitionSchema,
  views: z.array(viewSummarySchema),
  templates: z.array(templateSummarySchema),
  capabilities: z.strictObject({ write: z.boolean(), admin: z.boolean() }),
});

export const collectionListReplySchema = z.strictObject({
  collections: z.array(collectionSummarySchema),
});

export const rowColumnSchema = z.strictObject({
  key: propertyKeySchema,
  name: z.string().min(1).max(80),
  type: propertyTypeSchema,
});

export const collectionRowSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  jdArea: jdAreaSchema.nullable(),
  version: z.number().int().min(1).nullable(),
  group: z.string().nullable(),
  values: z.record(propertyKeySchema, z.json()),
});

export const rowGroupSchema = z.strictObject({
  value: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
  wipLimit: z.number().int().min(1).nullable(),
  visible: z.boolean(),
});

export const rowsReplySchema = z.strictObject({
  collection: collectionKeySchema,
  view: savedViewSchema.nullable(),
  columns: z.array(rowColumnSchema),
  rows: z.array(collectionRowSchema),
  groups: z.array(rowGroupSchema).nullable(),
  withheld: z.array(propertyKeySchema),
  next: z.string().nullable(),
});

export type ReadThroughValue = z.infer<typeof readThroughValueSchema>;
export type ViewSummary = z.infer<typeof viewSummarySchema>;
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;
export type CollectionReply = z.infer<typeof collectionReplySchema>;
export type RowColumn = z.infer<typeof rowColumnSchema>;
export type CollectionRow = z.infer<typeof collectionRowSchema>;
export type RowGroup = z.infer<typeof rowGroupSchema>;
export type RowsReply = z.infer<typeof rowsReplySchema>;

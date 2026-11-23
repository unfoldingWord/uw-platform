import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import {
  collectionDefinitionSchema,
  collectionKeySchema,
  propertyConfigSchema,
  propertyDefinitionSchema,
  propertyKeySchema,
} from './collections.ts';
import { groupValueSchema, viewSettingsSchema } from './collection-views.ts';

const request = { requestId: z.uuid() };
const collection = collectionKeySchema;
const values = z.record(propertyKeySchema, z.json());
const bodyMd = z.string().max(1_000_000);
const name = z
  .string()
  .max(80)
  .refine((value) => value.trim().length > 0, 'a name is not blank');

export const createCollectionCommandSchema = z.strictObject({
  command: z.literal('create_collection'),
  ...request,
  definition: collectionDefinitionSchema,
});

export const updateCollectionCommandSchema = z.strictObject({
  command: z.literal('update_collection'),
  ...request,
  collection,
  name,
  description: z.string().max(1000),
  locked: z.boolean(),
});

export const addPropertyCommandSchema = z.strictObject({
  command: z.literal('add_property'),
  ...request,
  collection,
  property: propertyDefinitionSchema,
});

export const updatePropertyCommandSchema = z.strictObject({
  command: z.literal('update_property'),
  ...request,
  collection,
  property: propertyDefinitionSchema,
});

export const changePropertyTypeCommandSchema = z.strictObject({
  command: z.literal('change_property_type'),
  ...request,
  collection,
  property: propertyKeySchema,
  config: propertyConfigSchema,
});

export const removePropertyCommandSchema = z.strictObject({
  command: z.literal('remove_property'),
  ...request,
  collection,
  property: propertyKeySchema,
});

export const createRowCommandSchema = z.strictObject({
  command: z.literal('create_row'),
  ...request,
  collection,
  rowId: z.uuid(),
  jdArea: jdAreaSchema,
  title: z
    .string()
    .max(200)
    .refine((value) => value.trim().length > 0, 'a title is not blank'),
  values: values.default({}),
  template: z.uuid().nullable().default(null),
});

export const setPropertyCommandSchema = z.strictObject({
  command: z.literal('set_property'),
  ...request,
  collection,
  rowId: z.uuid(),
  property: propertyKeySchema,
  value: z.json(),
});

export const moveCardCommandSchema = z.strictObject({
  command: z.literal('move_card'),
  ...request,
  viewId: z.uuid(),
  rowId: z.uuid(),
  group: groupValueSchema.nullable(),
  after: z.uuid().nullable(),
  before: z.uuid().nullable(),
});

export const saveViewCommandSchema = z.strictObject({
  command: z.literal('save_view'),
  ...request,
  collection,
  viewId: z.uuid(),
  settings: viewSettingsSchema,
});

export const deleteViewCommandSchema = z.strictObject({
  command: z.literal('delete_view'),
  ...request,
  viewId: z.uuid(),
});

export const saveTemplateCommandSchema = z.strictObject({
  command: z.literal('save_template'),
  ...request,
  collection,
  templateId: z.uuid(),
  name,
  values,
  bodyMd,
});

export const collectionCommandSchema = z.discriminatedUnion('command', [
  createCollectionCommandSchema,
  updateCollectionCommandSchema,
  addPropertyCommandSchema,
  updatePropertyCommandSchema,
  changePropertyTypeCommandSchema,
  removePropertyCommandSchema,
  createRowCommandSchema,
  setPropertyCommandSchema,
  moveCardCommandSchema,
  saveViewCommandSchema,
  deleteViewCommandSchema,
  saveTemplateCommandSchema,
]);

export const collectionCommandNameSchema = z.enum([
  'create_collection',
  'update_collection',
  'add_property',
  'update_property',
  'change_property_type',
  'remove_property',
  'create_row',
  'set_property',
  'move_card',
  'save_view',
  'delete_view',
  'save_template',
]);

export const collectionCommandAcceptedSchema = z.strictObject({
  status: z.literal('accepted'),
  requestId: z.uuid(),
  collection: collectionKeySchema,
  version: z.number().int().min(1),
  rowId: z.uuid().nullable(),
  viewId: z.uuid().nullable(),
});

export type CreateCollectionCommand = z.infer<typeof createCollectionCommandSchema>;
export type UpdateCollectionCommand = z.infer<typeof updateCollectionCommandSchema>;
export type AddPropertyCommand = z.infer<typeof addPropertyCommandSchema>;
export type UpdatePropertyCommand = z.infer<typeof updatePropertyCommandSchema>;
export type ChangePropertyTypeCommand = z.infer<typeof changePropertyTypeCommandSchema>;
export type RemovePropertyCommand = z.infer<typeof removePropertyCommandSchema>;
export type CreateRowCommand = z.infer<typeof createRowCommandSchema>;
export type SetPropertyCommand = z.infer<typeof setPropertyCommandSchema>;
export type MoveCardCommand = z.infer<typeof moveCardCommandSchema>;
export type SaveViewCommand = z.infer<typeof saveViewCommandSchema>;
export type DeleteViewCommand = z.infer<typeof deleteViewCommandSchema>;
export type SaveTemplateCommand = z.infer<typeof saveTemplateCommandSchema>;
export type CollectionCommand = z.infer<typeof collectionCommandSchema>;
export type CollectionCommandName = z.infer<typeof collectionCommandNameSchema>;
export type CollectionCommandAccepted = z.infer<typeof collectionCommandAcceptedSchema>;

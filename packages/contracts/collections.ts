import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { roleSchema } from './closed-sets.ts';
import { collectionPageTypes } from './pages.ts';

export const collectionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'a collection key is lowercase snake_case, at most 40 long');

export const propertyKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, 'a property key is lowercase snake_case, at most 48 long');

export const optionIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'an option id is lowercase, at most 40 long');

const label = z
  .string()
  .max(80)
  .refine((value) => value.trim().length > 0, 'a name is not blank');

export const rowSourceSchema = z.enum(['pages', 'tasks', 'people']);

export const propertyTypeSchema = z.enum([
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'person',
  'date',
  'date_range',
  'url',
  'email',
  'phone',
  'checkbox',
  'files',
  'relation',
  'rollup',
  'computed',
  'read_through',
  'created_time',
  'created_by',
  'edited_time',
  'edited_by',
  'completed_time',
]);

export const optionToneSchema = z.enum(['neutral', 'info', 'success', 'held']);
export const statusGroupSchema = z.enum(['to_do', 'in_progress', 'complete']);
export const numberFormatSchema = z.enum(['plain', 'percent']);
export const rollupFunctionSchema = z.enum(['count', 'sum', 'show_unique', 'percent_complete']);
export const computedFunctionSchema = z.enum(['sum', 'difference', 'count', 'date_until']);
export const readThroughFeedSchema = z.enum([
  'budget',
  'actuals',
  'committed',
  'remaining_need',
  'balance',
  'income_by_source',
  'sage_program_id',
]);
export const propertyClassificationSchema = z.enum(['internal', 'restricted', 'sensitive']);

export const selectOptionSchema = z.strictObject({
  id: optionIdSchema,
  name: label,
  tone: optionToneSchema.default('neutral'),
});

export const statusOptionSchema = selectOptionSchema.extend({ group: statusGroupSchema });

const distinctIds = (options: readonly { readonly id: string }[]) =>
  new Set(options.map((option) => option.id)).size === options.length;

const options = z.array(selectOptionSchema).max(200).refine(distinctIds, 'each option id once');

const statusOptions = z
  .array(statusOptionSchema)
  .min(1)
  .max(50)
  .refine(distinctIds, 'each option id once')
  .refine(
    (values) => statusGroupSchema.options.every((group) => values.some((o) => o.group === group)),
    'a status has an option in each of its three groups',
  );

export const propertySourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('frontmatter') }),
  z.strictObject({ kind: z.literal('column'), column: z.string().regex(/^[a-z][a-z_]{0,47}$/) }),
  z.strictObject({ kind: z.literal('derived') }),
]);

export const propertyRuleSchema = z.strictObject({
  steward: jdAreaSchema.nullable(),
  role: roleSchema,
  owner: z.boolean(),
});

const relationConfig = z.strictObject({
  target: collectionKeySchema,
  multiple: z.boolean(),
  reverse_of: propertyKeySchema.nullable().default(null),
});

const rollupConfig = z.strictObject({
  relation: propertyKeySchema,
  property: propertyKeySchema.nullable(),
  function: rollupFunctionSchema,
});

const computedConfig = z.strictObject({
  function: computedFunctionSchema,
  inputs: z.array(propertyKeySchema).min(1).max(10),
});

export const propertyConfigSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('title') }),
  z.strictObject({ type: z.literal('text'), multiline: z.boolean().default(false) }),
  z.strictObject({ type: z.literal('number'), format: numberFormatSchema.default('plain') }),
  z.strictObject({ type: z.literal('select'), options }),
  z.strictObject({ type: z.literal('multi_select'), options }),
  z.strictObject({ type: z.literal('status'), options: statusOptions }),
  z.strictObject({ type: z.literal('person'), multiple: z.boolean() }),
  z.strictObject({ type: z.literal('date') }),
  z.strictObject({ type: z.literal('date_range') }),
  z.strictObject({ type: z.literal('url') }),
  z.strictObject({ type: z.literal('email') }),
  z.strictObject({ type: z.literal('phone') }),
  z.strictObject({ type: z.literal('checkbox') }),
  z.strictObject({ type: z.literal('files') }),
  z.strictObject({ type: z.literal('relation'), relation: relationConfig }),
  z.strictObject({ type: z.literal('rollup'), rollup: rollupConfig }),
  z.strictObject({ type: z.literal('computed'), computed: computedConfig }),
  z.strictObject({ type: z.literal('read_through'), feed: readThroughFeedSchema }),
  z.strictObject({ type: z.literal('created_time') }),
  z.strictObject({ type: z.literal('created_by') }),
  z.strictObject({ type: z.literal('edited_time') }),
  z.strictObject({ type: z.literal('edited_by') }),
  z.strictObject({ type: z.literal('completed_time') }),
]);

export const storedTypes = [
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'person',
  'date',
  'date_range',
  'url',
  'email',
  'phone',
  'checkbox',
  'files',
] as const;

const storedTypeSet: ReadonlySet<string> = new Set(storedTypes);

export function isStoredType(type: PropertyType): boolean {
  return storedTypeSet.has(type);
}

function sourceFits(definition: {
  readonly config: PropertyConfig;
  readonly source: PropertySource;
}): boolean {
  const { type } = definition.config;
  const { kind } = definition.source;
  if (type === 'relation') return kind !== 'frontmatter';
  if (kind === 'derived') return !isStoredType(type);
  return isStoredType(type);
}

function ruleFits(definition: {
  readonly classification: PropertyClassification;
  readonly rule: PropertyRule | null;
}): boolean {
  return (definition.classification === 'internal') === (definition.rule === null);
}

export const propertyDefinitionSchema = z
  .strictObject({
    key: propertyKeySchema,
    name: label,
    config: propertyConfigSchema,
    source: propertySourceSchema,
    classification: propertyClassificationSchema.default('internal'),
    rule: propertyRuleSchema.nullable().default(null),
    required: z.boolean().default(false),
    hide_when_empty: z.boolean().default(false),
    section: label.nullable().default(null),
    description: z.string().max(500).default(''),
  })
  .refine(
    sourceFits,
    'a stored type reads a frontmatter key or a column, a relation reads links or a column, and the rest are derived',
  )
  .refine(ruleFits, 'a property narrower than internal declares its rule, and only then');

export const collectionDefinitionSchema = z
  .strictObject({
    key: collectionKeySchema,
    name: label,
    jdArea: jdAreaSchema,
    rowSource: rowSourceSchema,
    pageType: z.enum(collectionPageTypes).nullable(),
    description: z.string().max(1000).default(''),
    locked: z.boolean().default(false),
    properties: z.array(propertyDefinitionSchema).min(1).max(100),
  })
  .refine(
    (value) => (value.rowSource === 'pages') === (value.pageType !== null),
    'a page collection names its page type, and only a page collection does',
  )
  .refine(
    (value) => new Set(value.properties.map((p) => p.key)).size === value.properties.length,
    'each property key once',
  )
  .refine(
    (value) => value.properties.filter((p) => p.config.type === 'title').length === 1,
    'a collection has exactly one title property',
  );

export type CollectionKey = z.infer<typeof collectionKeySchema>;
export type PropertyKey = z.infer<typeof propertyKeySchema>;
export type RowSource = z.infer<typeof rowSourceSchema>;
export type PropertyType = z.infer<typeof propertyTypeSchema>;
export type StatusGroup = z.infer<typeof statusGroupSchema>;
export type SelectOption = z.infer<typeof selectOptionSchema>;
export type StatusOption = z.infer<typeof statusOptionSchema>;
export type PropertySource = z.infer<typeof propertySourceSchema>;
export type PropertyRule = z.infer<typeof propertyRuleSchema>;
export type PropertyConfig = z.infer<typeof propertyConfigSchema>;
export type PropertyClassification = z.infer<typeof propertyClassificationSchema>;
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>;
export type CollectionDefinition = z.infer<typeof collectionDefinitionSchema>;
export type ReadThroughFeed = z.infer<typeof readThroughFeedSchema>;
export type RollupFunction = z.infer<typeof rollupFunctionSchema>;
export type ComputedFunction = z.infer<typeof computedFunctionSchema>;

import { z } from 'zod';
import type {
  CollectionDefinition,
  PropertyConfig,
  PropertyDefinition,
  SelectOption,
} from './collections.ts';
import { isStoredType } from './collections.ts';

const isoDate = z.iso.date();
const phonePattern = /^\+?[0-9][0-9 ().-]{2,39}$/;

export const dateRangeValueSchema = z
  .strictObject({ start: isoDate, end: isoDate.nullable() })
  .refine(
    (range) => range.end === null || range.start <= range.end,
    'a range ends after it starts',
  );

const distinct = (values: readonly string[]) => new Set(values).size === values.length;

function optionIds(options: readonly SelectOption[]): z.ZodType<string> {
  const ids = new Set(options.map((option) => option.id));
  return z.string().refine((id) => ids.has(id), 'an option of this property');
}

const valueSchemaByType: {
  readonly [K in PropertyConfig['type']]?: (
    config: Extract<PropertyConfig, { type: K }>,
  ) => z.ZodType;
} = {
  title: () =>
    z
      .string()
      .max(200)
      .refine((value) => value.trim().length > 0, 'a title is not blank'),
  text: (config) => z.string().max(config.multiline ? 10_000 : 2000),
  number: () => z.number().refine(Number.isFinite, 'a finite number'),
  select: (config) => optionIds(config.options),
  status: (config) => optionIds(config.options),
  multi_select: (config) =>
    z.array(optionIds(config.options)).max(200).refine(distinct, 'each option once'),
  person: (config) =>
    config.multiple ? z.array(z.uuid()).max(100).refine(distinct, 'each person once') : z.uuid(),
  date: () => isoDate,
  date_range: () => dateRangeValueSchema,
  url: () => z.url({ protocol: /^https?$/ }).max(2000),
  email: () => z.email().max(320),
  phone: () => z.string().regex(phonePattern, 'a phone number'),
  checkbox: () => z.boolean(),
  files: () => z.array(z.uuid()).max(50).refine(distinct, 'each file once'),
};

function baseSchema(config: PropertyConfig): z.ZodType | null {
  const build = valueSchemaByType[config.type] as ((c: PropertyConfig) => z.ZodType) | undefined;
  return build === undefined ? null : build(config);
}

export function propertyValueSchema(property: PropertyDefinition): z.ZodType | null {
  const base = baseSchema(property.config);
  if (base === null) return null;
  if (property.required) return base;
  return base.nullable();
}

export function storedProperties(definition: CollectionDefinition): readonly PropertyDefinition[] {
  return definition.properties.filter(
    (property) => property.source.kind === 'frontmatter' && isStoredType(property.config.type),
  );
}

export function compileRowSchema(definition: CollectionDefinition): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const property of storedProperties(definition)) {
    const schema = propertyValueSchema(property);
    if (schema === null) continue;
    shape[property.key] = property.required ? schema : schema.optional();
  }
  return z.strictObject(shape);
}

export function emptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

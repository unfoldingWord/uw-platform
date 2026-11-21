import { z } from 'zod';
import { propertyKeySchema, type PropertyType } from './collections.ts';

export const dateUnitSchema = z.enum(['day', 'week', 'month', 'year']);

export const dateOperandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('date'), date: z.iso.date() }),
  z.strictObject({ kind: z.literal('today') }),
  z.strictObject({
    kind: z.literal('relative'),
    direction: z.enum(['past', 'next']),
    unit: dateUnitSchema,
    amount: z.number().int().min(1).max(1000),
  }),
]);

export const meOperandSchema = z.strictObject({ kind: z.literal('me') });

export const filterOperatorSchema = z.enum([
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'is_any_of',
  'group_is',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'within',
  'is_empty',
  'is_not_empty',
]);

export const filterValueSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  dateOperandSchema,
  meOperandSchema,
  z.null(),
]);

export const filterConditionSchema = z.strictObject({
  kind: z.literal('condition'),
  property: propertyKeySchema,
  operator: filterOperatorSchema,
  value: filterValueSchema,
});

export type FilterCondition = z.infer<typeof filterConditionSchema>;
export type FilterGroup = {
  readonly kind: 'group';
  readonly conjunction: 'and' | 'or';
  readonly children: readonly (FilterCondition | FilterGroup)[];
};

const MAX_DEPTH = 3;

function depthOf(group: FilterGroup): number {
  const nested = group.children.filter((child): child is FilterGroup => child.kind === 'group');
  return 1 + Math.max(0, ...nested.map(depthOf));
}

const groupShape: z.ZodType<FilterGroup> = z.lazy(() =>
  z.strictObject({
    kind: z.literal('group'),
    conjunction: z.enum(['and', 'or']),
    children: z.array(z.union([filterConditionSchema, groupShape])).max(20),
  }),
);

export const filterGroupSchema = groupShape.refine(
  (group) => depthOf(group) <= MAX_DEPTH,
  'filter groups nest at most three deep',
);

export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const rowSortSchema = z.strictObject({
  property: propertyKeySchema,
  direction: sortDirectionSchema,
});

export const groupBySchema = z.enum(['value', 'status_group']);

export const rowGroupingSchema = z.strictObject({
  property: propertyKeySchema,
  by: groupBySchema.default('value'),
});

export const rowQuerySchema = z.strictObject({
  filter: filterGroupSchema.nullable().default(null),
  sorts: z.array(rowSortSchema).max(5).default([]),
  group: rowGroupingSchema.nullable().default(null),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z
    .string()
    .regex(/^[0-9]{1,7}$/)
    .nullable()
    .default(null),
});

const textOps = ['is', 'is_not', 'contains', 'not_contains', 'starts_with'] as const;
const emptyOps = ['is_empty', 'is_not_empty'] as const;
const numberOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
const dateOps = ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'within'] as const;
const choiceOps = ['is', 'is_not', 'is_any_of'] as const;
const listOps = ['contains', 'not_contains', 'is_any_of'] as const;

export const operatorsByType: Readonly<Record<PropertyType, readonly FilterOperator[]>> = {
  title: [...textOps, ...emptyOps],
  text: [...textOps, ...emptyOps],
  url: [...textOps, ...emptyOps],
  email: [...textOps, ...emptyOps],
  phone: [...textOps, ...emptyOps],
  number: [...numberOps, ...emptyOps],
  select: [...choiceOps, ...emptyOps],
  status: [...choiceOps, 'group_is', ...emptyOps],
  multi_select: [...listOps, ...emptyOps],
  person: [...listOps, ...emptyOps],
  relation: [...listOps, ...emptyOps],
  files: [...emptyOps],
  date: [...dateOps, ...emptyOps],
  date_range: [...dateOps, ...emptyOps],
  checkbox: ['is'],
  rollup: [...numberOps, ...emptyOps],
  computed: [...numberOps, ...emptyOps],
  read_through: [],
  created_time: [...dateOps],
  edited_time: [...dateOps],
  completed_time: [...dateOps, ...emptyOps],
  created_by: ['contains', 'not_contains'],
  edited_by: ['contains', 'not_contains'],
};

const sortableTypes: ReadonlySet<PropertyType> = new Set([
  'title',
  'text',
  'url',
  'email',
  'phone',
  'number',
  'select',
  'status',
  'date',
  'date_range',
  'checkbox',
  'rollup',
  'computed',
  'created_time',
  'edited_time',
  'completed_time',
]);

const groupableTypes: ReadonlySet<PropertyType> = new Set([
  'select',
  'status',
  'multi_select',
  'person',
  'checkbox',
  'relation',
]);

export function sortableType(type: PropertyType): boolean {
  return sortableTypes.has(type);
}

export function groupableType(type: PropertyType): boolean {
  return groupableTypes.has(type);
}

export function conditionsOf(group: FilterGroup | null): readonly FilterCondition[] {
  if (group === null) return [];
  return group.children.flatMap((child) =>
    child.kind === 'condition' ? [child] : conditionsOf(child),
  );
}

export type FilterOperator = z.infer<typeof filterOperatorSchema>;
export type FilterValue = z.infer<typeof filterValueSchema>;
export type DateOperand = z.infer<typeof dateOperandSchema>;
export type RowSort = z.infer<typeof rowSortSchema>;
export type RowGrouping = z.infer<typeof rowGroupingSchema>;
export type RowQuery = z.infer<typeof rowQuerySchema>;

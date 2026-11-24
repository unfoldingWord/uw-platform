import type {
  FilterCondition,
  FilterGroup,
  RowGrouping,
  RowSort,
  ViewSettings,
} from '@uw/contracts';

type Named = { readonly key: string; readonly name: string };

export type ViewPlace = { readonly month: string | null; readonly cursor: string | null };

type Shown = Pick<ViewSettings, 'filter' | 'sorts'> & { readonly group: RowGrouping | null };

const operatorWords: Readonly<Record<FilterCondition['operator'], string>> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  is_any_of: 'is any of',
  group_is: 'is in the group',
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  before: 'is before',
  after: 'is after',
  on_or_before: 'is on or before',
  on_or_after: 'is on or after',
  within: 'is within',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

function nameOf(properties: readonly Named[], key: string): string {
  return properties.find((property) => property.key === key)?.name ?? key;
}

function quoted(text: string): string {
  return `"${text}"`;
}

function plural(amount: number, unit: string): string {
  return amount === 1 ? `1 ${unit}` : `${String(amount)} ${unit}s`;
}

function operandWords(value: Exclude<FilterCondition['value'], null>): string {
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'checked' : 'not checked';
  if (Array.isArray(value)) return value.map(quoted).join(', ');
  if (value.kind === 'me') return 'me';
  if (value.kind === 'today') return 'today';
  if (value.kind === 'date') return value.date;
  return `the ${value.direction} ${plural(value.amount, value.unit)}`;
}

function conditionWords(condition: FilterCondition, properties: readonly Named[]): string {
  const said = `${nameOf(properties, condition.property)} ${operatorWords[condition.operator]}`;
  return condition.value === null ? said : `${said} ${operandWords(condition.value)}`;
}

function groupWords(group: FilterGroup, properties: readonly Named[], nested: boolean): string {
  const parts = group.children
    .map((child) =>
      child.kind === 'condition'
        ? conditionWords(child, properties)
        : groupWords(child, properties, true),
    )
    .filter((part) => part !== '');
  const joined = parts.join(` ${group.conjunction} `);
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

function sortWords(sorts: readonly RowSort[], properties: readonly Named[]): string {
  return sorts
    .map(
      (sort) =>
        `${nameOf(properties, sort.property)} ${sort.direction === 'asc' ? 'ascending' : 'descending'}`,
    )
    .join(', then ');
}

function groupingWords(group: RowGrouping, properties: readonly Named[]): string {
  const name = nameOf(properties, group.property);
  return group.by === 'status_group' ? `${name}, by status group` : name;
}

export function viewFilters(
  settings: Shown,
  properties: readonly Named[],
  place: ViewPlace,
): readonly string[] {
  const filter = settings.filter === null ? '' : groupWords(settings.filter, properties, false);
  return [
    ...(filter === '' ? [] : [`Filter: ${filter}`]),
    ...(settings.sorts.length === 0 ? [] : [`Sort: ${sortWords(settings.sorts, properties)}`]),
    ...(settings.group === null ? [] : [`Group: ${groupingWords(settings.group, properties)}`]),
    ...(place.month === null ? [] : [`Month: ${place.month}`]),
    ...(place.cursor === null ? [] : [`From row: ${String(Number(place.cursor) + 1)}`]),
  ];
}
